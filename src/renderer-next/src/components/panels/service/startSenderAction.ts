import { api } from '@/lib/api'
import { availableAiRoutes } from '@/lib/aiEnvironments'
import { canStartWorkspaceProxy, type WorkspaceMode } from '@/lib/workspaceCapabilities'
import { useAppStore } from '@/store/useAppStore'
import type { SenderSettings } from '@/types/settings'
import { DEFAULT_TARGET_DOMAINS, isPortNumber, safeText } from './helpers'

const EMPTY_SENDER: SenderSettings = {
  proxy_server: '',
  proxy_port: '',
  proxy_uuid: '',
  socks_listen_port: '',
  fallback_mode: 'system_proxy',
  fallback_local_port: '',
  target_domains: '',
}

export function resolveSenderForm(
  settingsSender: Partial<SenderSettings> | undefined,
  mode: string,
) {
  const form: SenderSettings = { ...EMPTY_SENDER, ...(settingsSender ?? {}) }
  const personalProtocol: 'socks5' | 'http' =
    form.personal_proxy_protocol === 'http' ? 'http' : 'socks5'
  const personalHost =
    safeText(form.personal_proxy_host) || safeText(form.proxy_server) || '127.0.0.1'
  const personalPort = safeText(form.personal_proxy_port) || safeText(form.proxy_port)
  const resolvedTargetDomains =
    mode === 'sender'
      ? DEFAULT_TARGET_DOMAINS
      : safeText(form.target_domains) || DEFAULT_TARGET_DOMAINS
  const routes = availableAiRoutes(form)
  const unifiedAvailable = routes.some((route) => route.id === 'internal-unified')
  const airportAvailable =
    Boolean(form.airport_outbound) && routes.some((route) => route.id === 'internal-airport')

  return {
    form,
    personalProtocol,
    personalHost,
    personalPort,
    resolvedTargetDomains,
    routes,
    unifiedAvailable,
    airportAvailable,
  }
}

export function validateSenderConfig(
  settingsSender: Partial<SenderSettings> | undefined,
  mode: string,
  workspaceMode: WorkspaceMode,
): string | null {
  const { form, personalHost, personalPort, unifiedAvailable, airportAvailable } =
    resolveSenderForm(settingsSender, mode)
  const personalWorkspace = workspaceMode === 'personal'
  if (personalWorkspace) {
    if (!personalHost) return '请填写代理地址'
    if (!isPortNumber(personalPort)) return '代理端口必须为数字'
    return null
  }
  if (form.proxy_mode === 'airport') {
    if (!airportAvailable) return '机场节点暂不可用，请选择其他可用线路或联系管理员'
  } else {
    const server = safeText(form.proxy_server)
    if (!server) return '请先填写服务器地址，再开启代理'
    if (!isPortNumber(safeText(form.proxy_port))) return '连接端口必须为数字'
    if (!safeText(form.proxy_uuid)) return '请填写连接身份码'
    if (!unifiedAvailable) return '统一梯子暂不可用，请选择其他可用线路或联系管理员'
  }
  const socks = safeText(form.socks_listen_port)
  if (socks && !isPortNumber(socks)) return '本地代理端口必须为数字'
  if (form.fallback_mode !== 'direct') {
    const fb = safeText(form.fallback_local_port)
    if (fb && !isPortNumber(fb)) return '本机已有代理端口必须为数字'
  }
  return null
}

export async function startWorkspaceSender(options: {
  workspaceMode: WorkspaceMode
  online: boolean
}): Promise<void> {
  const { settings, mode, patchSection } = useAppStore.getState()
  const err = validateSenderConfig(settings?.sender, mode, options.workspaceMode)
  if (err) throw new Error(err)
  if (!canStartWorkspaceProxy(options.workspaceMode, options.online)) {
    throw new Error('请先登录账号并保持在线')
  }
  const { form, personalProtocol, personalHost, personalPort, resolvedTargetDomains } =
    resolveSenderForm(settings?.sender, mode)
  const personalWorkspace = options.workspaceMode === 'personal'
  const payload: SenderSettings = personalWorkspace
    ? {
        ...form,
        proxy_mode: 'personal',
        personal_proxy_protocol: personalProtocol,
        personal_proxy_host: personalHost,
        personal_proxy_port: personalPort,
        fallback_mode: 'direct',
        route_all: false,
        target_domains: resolvedTargetDomains,
      }
    : {
        ...form,
        target_domains: resolvedTargetDomains,
      }

  if (personalWorkspace) {
    await patchSection('sender', {
      proxy_mode: 'personal',
      personal_proxy_protocol: payload.personal_proxy_protocol,
      personal_proxy_host: payload.personal_proxy_host,
      personal_proxy_port: payload.personal_proxy_port,
      fallback_mode: 'direct',
      route_all: false,
      target_domains: payload.target_domains,
    })
  } else if (payload.target_domains !== safeText(form.target_domains)) {
    await patchSection('sender', { target_domains: payload.target_domains })
  }
  const started = (await api.startSender(payload)) as { socksPort?: unknown } | null
  const runtimePort = safeText(started?.socksPort)
  if (personalWorkspace && isPortNumber(runtimePort)) {
    await patchSection('sender', { socks_listen_port: runtimePort })
  }
}
