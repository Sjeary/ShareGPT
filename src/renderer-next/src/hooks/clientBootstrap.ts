import { api } from '@/lib/api'
import {
  PROXY_AUTHORIZATION_UNAVAILABLE,
  invalidateProxyAuthorization,
  proxyAuthorizationInvalidationPatch,
  runAuthoritativeBootstrapRefresh,
} from '@/lib/collabBootstrapAuthorization'
import { useAppStore } from '@/store/useAppStore'
import {
  settingsPrincipalRuntime,
  type SettingsPrincipalSnapshot,
} from '@/lib/settingsPrincipalRuntime'
import {
  hasCompleteSenderBootstrap,
  normalizeBootstrapPayload,
  type BootstrapPayload,
  type BootstrapSender,
} from '@/components/panels/account/bootstrap'
import type { SenderSettings } from '@/types/settings'
import { shouldApplyManagedProxy } from '@/lib/managedProxyPolicy'

const BOOTSTRAP_TIMEOUT_MS = 10000
const DISCARD_TOKEN_TIMEOUT_MS = 3000

interface ClientBootstrapOptions {
  allowLegacyAdminConfig?: boolean
  managedConfigEditable?: boolean
  principalSnapshot?: SettingsPrincipalSnapshot
}

function assertBootstrapPrincipal(options: ClientBootstrapOptions): void {
  if (options.principalSnapshot) settingsPrincipalRuntime.assertCurrent(options.principalSnapshot)
}

async function patchSenderForBootstrap(
  patch: Partial<SenderSettings>,
  options: ClientBootstrapOptions,
): Promise<void> {
  assertBootstrapPrincipal(options)
  await useAppStore.getState().patchSection('sender', patch)
  assertBootstrapPrincipal(options)
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

async function fetchBootstrapRaw(serverUrl: string, token: string): Promise<unknown> {
  const cleaned = trimTrailingSlash(serverUrl.trim())
  if (!cleaned || !token) throw new Error('缺少协作服务器或登录凭据')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), BOOTSTRAP_TIMEOUT_MS)
  try {
    const response = await fetch(`${cleaned}/api/client/bootstrap`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(text || `读取客户端配置失败（${response.status}）`)
    }
    return await response.json().catch(() => null)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('读取线路授权超时，请检查服务地址或网络', { cause: error })
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function applySenderBootstrapConfig(
  serverSender: BootstrapSender,
  options: ClientBootstrapOptions,
): Promise<boolean> {
  if (!hasCompleteSenderBootstrap(serverSender)) return false

  const current = (useAppStore.getState().settings?.sender ?? {}) as Partial<SenderSettings>
  if (!shouldApplyManagedProxy(current, serverSender, options.managedConfigEditable === true)) {
    return false
  }

  await patchSenderForBootstrap(
    {
      proxy_server: serverSender.proxy_server || current.proxy_server || '',
      proxy_port: serverSender.proxy_port || current.proxy_port || '',
      proxy_uuid: serverSender.proxy_uuid || current.proxy_uuid || '',
      socks_listen_port: serverSender.socks_listen_port || current.socks_listen_port || '',
      fallback_mode: serverSender.fallback_mode || current.fallback_mode || 'system_proxy',
      fallback_local_port: serverSender.fallback_local_port || current.fallback_local_port || '',
      target_domains: serverSender.target_domains || current.target_domains || '',
    },
    options,
  )
  return true
}

async function applyClientBootstrap(
  raw: unknown,
  options: ClientBootstrapOptions = {},
): Promise<BootstrapPayload> {
  const payload = normalizeBootstrapPayload(raw, options)
  await applySenderBootstrapConfig(payload.sender, options)
  await patchSenderForBootstrap(
    {
      managed_proxy_routes: payload.proxyRoutes
        .filter((route) => route.kind === 'managed' && route.outbound)
        .map((route) => ({
          id: route.id,
          name: route.name,
          enabled: route.enabled,
          kind: 'managed' as const,
          outbound: route.outbound || {},
          expected: route.expected,
        })),
      authorized_proxy_route_ids: payload.proxyRoutes.map((route) => route.id),
      airport_outbound:
        payload.proxyRoutes.find((route) => route.id === 'internal-airport')?.outbound ||
        payload.airport?.outbound ||
        null,
      airport_name:
        payload.proxyRoutes.find((route) => route.id === 'internal-airport')?.name ||
        payload.airport?.name ||
        '',
    },
    options,
  )
  return payload
}

function translateBootstrapError(error: unknown): never {
  if (error instanceof Error && error.message === PROXY_AUTHORIZATION_UNAVAILABLE) {
    throw new Error('服务器线路授权暂不可用，请稍后重试', { cause: error })
  }
  throw error
}

export async function invalidateClientProxyAuthorization(
  options: ClientBootstrapOptions = {},
): Promise<void> {
  await invalidateProxyAuthorization({
    clearMemory: () => {
      assertBootstrapPrincipal(options)
      const settings = useAppStore.getState().settings
      if (!settings) return
      useAppStore.setState({
        settings: {
          ...settings,
          sender: {
            ...settings.sender,
            ...proxyAuthorizationInvalidationPatch(),
          },
        },
      })
    },
    persistClearedAuthorization: () =>
      patchSenderForBootstrap(proxyAuthorizationInvalidationPatch(), options),
    // Receiver mode and an already-stopped sender both legitimately reject this IPC. The
    // authorization proof is cleared before this best-effort runtime cleanup is attempted.
    stopSender: () => api.stopSender(),
  })
}

export async function fetchAndApplyAuthoritativeClientBootstrap(
  serverUrl: string,
  token: string,
  options: ClientBootstrapOptions = {},
): Promise<BootstrapPayload> {
  try {
    return await runAuthoritativeBootstrapRefresh({
      invalidate: async () => undefined,
      fetchBootstrap: () => fetchBootstrapRaw(serverUrl, token),
      applyBootstrap: (raw) => applyClientBootstrap(raw, options),
      compatibility: options,
      assertCurrent: () => assertBootstrapPrincipal(options),
    })
  } catch (error) {
    return translateBootstrapError(error)
  }
}

export async function refreshAuthoritativeClientBootstrap(
  serverUrl: string,
  token: string,
  options: ClientBootstrapOptions = {},
): Promise<BootstrapPayload> {
  try {
    return await runAuthoritativeBootstrapRefresh({
      invalidate: () => invalidateClientProxyAuthorization(options),
      fetchBootstrap: () => fetchBootstrapRaw(serverUrl, token),
      applyBootstrap: (raw) => applyClientBootstrap(raw, options),
      compatibility: options,
      assertCurrent: () => assertBootstrapPrincipal(options),
    })
  } catch (error) {
    return translateBootstrapError(error)
  }
}

export async function discardCollabToken(serverUrl: string, token: string): Promise<void> {
  const cleaned = trimTrailingSlash(serverUrl.trim())
  if (!cleaned || !token) return
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DISCARD_TOKEN_TIMEOUT_MS)
  try {
    await fetch(`${cleaned}/api/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    }).catch(() => undefined)
  } finally {
    clearTimeout(timer)
  }
}
