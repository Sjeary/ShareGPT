import { useCallback } from 'react'
import { api } from '@/lib/api'
import { settingsPrincipalRuntime } from '@/lib/settingsPrincipalRuntime'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore, type AuthProfile } from '@/store/useAuthStore'
import { useChatStore } from '@/store/useChatStore'
import { useNotesAiStore } from '@/store/useNotesAiStore'
import { useTranslationStore } from '@/store/useTranslationStore'
import { normalizeChatMessage, normalizeDirectory } from '@/components/panels/chat/normalize'
import {
  hasCompleteSenderBootstrap,
  normalizeBootstrapPayload,
  type BootstrapPayload,
  type BootstrapSender,
} from '@/components/panels/account/bootstrap'
import type { AppSettings, SenderSettings } from '@/types/settings'
import { isComposerGuardEligible } from '@/lib/translationSession'

// 协作服务器登录/退出逻辑 (移植自旧 renderer.js performCollabLogin / collabLogout)。
// 端点 (渲染层直连协作服务器, 非 IPC):
//   POST {server}/api/login   body: { username, password, client }
//     -> { token, username, profile:{avatar,displayName}, ... }
//   POST {server}/api/logout  header: Authorization: Bearer <token>
//
// 登录成功后: 写 useAuthStore(token/profile/runtimePassword)、useAppStore.setAuthed(true)、
//   持久化 collab.* 设置 (server_url / last_username / last_avatar / remember_password / saved_password)。

const LOGIN_TIMEOUT_MS = 10000
const LOGOUT_TIMEOUT_MS = 5000
const BOOTSTRAP_TIMEOUT_MS = 10000

export interface LoginParams {
  serverUrl: string
  username: string
  password: string
  rememberPassword: boolean
}

interface LoginResponse {
  token?: string
  username?: string
  profile?: {
    avatar?: string
    displayName?: string
    isAdmin?: boolean
    advancedAiAllowed?: boolean
    allowedProxyRouteIds?: string[]
    chatDisabled?: boolean
  }
  // 登录响应可携带初始历史/在线名录, 用于 WS 建连前即时灌入 (旧 performCollabLogin ~4593)。
  history?: unknown
  users?: unknown
  onlineUsers?: unknown
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

// 与旧 renderer.js getClientVersionPayload 对齐 (服务器据此记录客户端信息)。
// 兜底: 若 store 里的 meta 尚未就绪或缺 version, 直接向主进程取 (app.getVersion),
// 避免上报空版本 — 修复「客户端版本统计为空」的问题; 并回填 store 供侧栏/账户读取。
async function clientVersionPayload(): Promise<Record<string, unknown>> {
  let meta = useAppStore.getState().meta as Record<string, unknown>
  if (!meta || !meta.version) {
    try {
      const fresh = await api.getAppMeta()
      if (fresh && typeof fresh === 'object' && (fresh as Record<string, unknown>).version) {
        meta = fresh as Record<string, unknown>
        useAppStore.setState({ meta })
      }
    } catch {
      /* 保留 store 现值 */
    }
  }
  return {
    name: String(meta?.name ?? 'ShareGPT'),
    version: String(meta?.version ?? ''),
    platform: String(meta?.platform ?? api.platform ?? ''),
    arch: String(meta?.arch ?? ''),
    mode: String(useAppStore.getState().mode ?? ''),
    reportedAt: new Date().toISOString(),
  }
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('连接服务器超时，请检查服务地址或网络', { cause: err })
    }
    throw new Error('无法连接到服务器，请检查服务地址或网络', { cause: err })
  } finally {
    clearTimeout(timer)
  }
}

// 本机 sender 配置不完整时, 用服务器下发的 sender 字段补全并持久化。
// 移植自旧 renderer.js applySenderBootstrapConfig(~2770):
//   - 服务器下发的 sender 本身不完整 -> 不动 (return)。
//   - 本机 sender 已完整 -> 不覆盖用户已填内容 (return)。
//   - 否则合并 (服务器值优先填空位) 并 patchSection('sender',...) 落盘。
async function applySenderBootstrapConfig(
  serverSender: BootstrapSender,
  isCurrent?: () => boolean,
): Promise<boolean> {
  if (isCurrent && !isCurrent()) return false
  if (!hasCompleteSenderBootstrap(serverSender)) {
    return false
  }

  const current = (useAppStore.getState().settings?.sender ?? {}) as Partial<SenderSettings>
  if (hasCompleteSenderBootstrap(current)) {
    const expectedIdentity = {
      proxy_expected_ip: serverSender.proxy_expected_ip || '',
      proxy_expected_country: serverSender.proxy_expected_country || '',
      proxy_expected_asn: serverSender.proxy_expected_asn || '',
    }
    const changed = Object.entries(expectedIdentity).some(
      ([key, value]) => String(current[key as keyof SenderSettings] || '') !== value,
    )
    if (changed) {
      if (isCurrent && !isCurrent()) return false
      await useAppStore.getState().patchSection('sender', expectedIdentity)
    }
    return changed
  }

  const merged: Partial<SenderSettings> = {
    proxy_server: serverSender.proxy_server || current.proxy_server || '',
    proxy_port: serverSender.proxy_port || current.proxy_port || '',
    proxy_uuid: serverSender.proxy_uuid || current.proxy_uuid || '',
    proxy_expected_ip: serverSender.proxy_expected_ip || current.proxy_expected_ip || '',
    proxy_expected_country:
      serverSender.proxy_expected_country || current.proxy_expected_country || '',
    proxy_expected_asn: serverSender.proxy_expected_asn || current.proxy_expected_asn || '',
    socks_listen_port: serverSender.socks_listen_port || current.socks_listen_port || '',
    fallback_mode: serverSender.fallback_mode || current.fallback_mode || 'system_proxy',
    fallback_local_port: serverSender.fallback_local_port || current.fallback_local_port || '',
    target_domains: serverSender.target_domains || current.target_domains || '',
  }

  if (isCurrent && !isCurrent()) return false
  await useAppStore.getState().patchSection('sender', merged)
  return true
}

// 登录后拉取客户端 bootstrap (更新信息 + 发送端配置同步)。
// 移植自旧 renderer.js fetchClientBootstrap(~2870): best-effort, 失败不阻塞登录。
export async function fetchClientBootstrap(
  serverUrl: string,
  token: string,
): Promise<BootstrapPayload | null> {
  const cleaned = trimTrailingSlash(serverUrl.trim())
  if (!cleaned || !token) return null

  const response = await fetchWithTimeout(
    `${cleaned}/api/client/bootstrap`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    },
    BOOTSTRAP_TIMEOUT_MS,
  )

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `读取客户端配置失败（${response.status}）`)
  }

  const payload = normalizeBootstrapPayload(await response.json().catch(() => null))
  return payload
}

export async function clearRemoteRouteState(isCurrent?: () => boolean): Promise<void> {
  if (isCurrent && !isCurrent()) return
  await useAppStore.getState().patchSection('sender', {
    managed_proxy_routes: [],
    authorized_proxy_route_ids: [],
    airport_outbound: null,
    airport_name: '',
  })
}

export async function applyClientBootstrap(
  payload: BootstrapPayload,
  isCurrent?: () => boolean,
): Promise<void> {
  if (isCurrent && !isCurrent()) return
  await applySenderBootstrapConfig(payload.sender, isCurrent)
  if (isCurrent && !isCurrent()) return
  // 管理端节点是权威配置：更新时覆盖，撤销时也清掉本机旧副本。
  // 缺少权威 routes 数组时保持 fail-closed，不沿用旧账号授权。
  await useAppStore.getState().patchSection('sender', {
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
    authorized_proxy_route_ids: payload.proxyRoutesAuthoritative
      ? payload.proxyRoutes.map((route) => route.id)
      : [],
    airport_outbound:
      payload.proxyRoutes.find((route) => route.id === 'internal-airport')?.outbound ||
      payload.airport?.outbound ||
      null,
    airport_name:
      payload.proxyRoutes.find((route) => route.id === 'internal-airport')?.name ||
      payload.airport?.name ||
      '',
  })
}

export function useAuth() {
  const setAuthed = useAppStore((s) => s.setAuthed)
  const patchSection = useAppStore((s) => s.patchSection)
  const setSession = useAuthStore((s) => s.setSession)
  const clearSession = useAuthStore((s) => s.clearSession)

  const login = useCallback(
    async ({ serverUrl, username, password, rememberPassword }: LoginParams) => {
      const cleanedServer = trimTrailingSlash(serverUrl.trim())
      const cleanedUser = username.trim()

      if (!cleanedServer || !cleanedUser || !password) {
        throw new Error('请先填写完整的服务地址、账号和密码')
      }
      if (!/^https?:\/\//i.test(cleanedServer)) {
        throw new Error('服务地址需要以 http:// 或 https:// 开头')
      }
      let parsedServer: URL
      try {
        parsedServer = new URL(cleanedServer)
      } catch {
        throw new Error('服务地址格式不正确')
      }
      if (
        (parsedServer.protocol !== 'http:' && parsedServer.protocol !== 'https:') ||
        parsedServer.username ||
        parsedServer.password ||
        parsedServer.search ||
        parsedServer.hash ||
        cleanedServer.includes('?') ||
        cleanedServer.includes('#')
      ) {
        throw new Error('服务地址不能包含账号信息、查询参数或片段')
      }

      const response = await fetchWithTimeout(
        `${cleanedServer}/api/login`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: cleanedUser,
            password,
            client: await clientVersionPayload(),
          }),
        },
        LOGIN_TIMEOUT_MS,
      )

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(text || `登录失败（${response.status}）`)
      }

      const payload = (await response.json().catch(() => null)) as LoginResponse | null
      if (!payload?.token) {
        throw new Error('登录未成功，请稍后重试')
      }
      const confirmedUsername = typeof payload.username === 'string' ? payload.username : ''
      if (!confirmedUsername.trim()) {
        throw new Error('服务器未返回已确认的账号身份')
      }

      // 在暴露新会话前先清除上一账号的远程线路，再读取服务器的权威 bootstrap。
      // bootstrap 失败仍允许基础聊天登录，但高级 AI 保持 fail-closed。
      const previousSettingsPrincipal = settingsPrincipalRuntime.current()
      settingsPrincipalRuntime.invalidate()
      await api.stopSender().catch(() => {})
      await api.closeAllAiWorkspaces().catch(() => {})
      let principal: Awaited<ReturnType<typeof api.activateSettingsPrincipal>>
      try {
        principal = await api.activateSettingsPrincipal({
          serverUrl: cleanedServer,
          username: confirmedUsername,
        })
      } catch (error) {
        if (previousSettingsPrincipal.principalId) {
          settingsPrincipalRuntime.activate(previousSettingsPrincipal.principalId)
        }
        throw error
      }
      settingsPrincipalRuntime.activate(principal.principalId)
      const principalSettings = principal.settings as unknown as AppSettings
      useAppStore.setState({ settings: principalSettings })
      useTranslationStore
        .getState()
        .resetForPrincipal(principal.principalId, principalSettings.translation)
      useNotesAiStore
        .getState()
        .resetForPrincipal(principal.principalId, principalSettings.translation)
      await clearRemoteRouteState()
      let bootstrap: BootstrapPayload | null = null
      try {
        bootstrap = await fetchClientBootstrap(cleanedServer, payload.token)
        if (bootstrap) await applyClientBootstrap(bootstrap)
      } catch {
        // 基础聊天仍可登录，但 routeAuthorizationVerified 保持 false。
      }

      const routeAuthorizationVerified = Boolean(bootstrap?.proxyRoutesAuthoritative)
      const profile: AuthProfile = {
        username: confirmedUsername,
        displayName: (payload.profile?.displayName ?? '').trim() || confirmedUsername,
        avatar: (payload.profile?.avatar ?? '').trim(),
        isAdmin: Boolean(payload.profile?.isAdmin),
        advancedAiAllowed: Boolean(payload.profile?.advancedAiAllowed),
        routeAuthorizationVerified,
        allowedProxyRouteIds: routeAuthorizationVerified
          ? bootstrap?.proxyRoutes.map((route) => route.id) || []
          : [],
        chatDisabled: Boolean(payload.profile?.chatDisabled),
      }

      // 持久化登录偏好成功后才公开运行期会话，避免半登录状态。
      await patchSection('collab', {
        server_url: cleanedServer,
        last_username: confirmedUsername,
        last_avatar: profile.avatar,
        remember_password: rememberPassword,
        saved_password: rememberPassword ? password : '',
      })

      await api.setAiComposerEligibility({
        principalId: principal.principalId,
        eligible: isComposerGuardEligible(profile, payload.token),
        token: payload.token,
      })
      setSession({ token: payload.token, profile, password })

      // 把登录身份写入聊天 store, 触发 useChat 的 WS 连接与鉴权统计。
      // (移植自旧 renderer.js performCollabLogin ~4572: state.collab.token/username/...
      //  + setCollabIdentity。这里只写身份, WS 由 useChat 监听 identity.token 自动建连。)
      useChatStore.getState().setIdentity({
        serverUrl: cleanedServer,
        token: payload.token,
        username: confirmedUsername,
        displayName: profile.displayName,
        avatar: profile.avatar,
      })

      // 登录响应可携带初始 history/users, WS 建连前即时灌入避免空白
      // (移植自旧 renderer.js performCollabLogin ~4593: renderHistory / setUserDirectory)。
      if (Array.isArray(payload.history) && payload.history.length) {
        useChatStore.getState().mergeMessages(payload.history.map((m) => normalizeChatMessage(m)))
      }
      const rawUsers = Array.isArray(payload.users)
        ? payload.users
        : Array.isArray(payload.onlineUsers)
          ? payload.onlineUsers
          : null
      if (rawUsers) {
        useChatStore.getState().setDirectory(normalizeDirectory(rawUsers))
      }

      setAuthed(true)

      return profile
    },
    [patchSection, setAuthed, setSession],
  )

  const logout = useCallback(async () => {
    settingsPrincipalRuntime.invalidate()
    const { token, profile } = useAuthStore.getState()
    const serverUrl = trimTrailingSlash(
      String(useAppStore.getState().settings?.collab?.server_url ?? '').trim(),
    )

    // 通知服务器下线 (best-effort, 失败不阻塞本地退出)。
    if (serverUrl && token) {
      try {
        await fetchWithTimeout(
          `${serverUrl}/api/logout`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
          },
          LOGOUT_TIMEOUT_MS,
        )
      } catch {
        /* 忽略: 本地仍照常退出 */
      }
    }

    // 账号下线后不再以本机转发: 停止发送服务 (best-effort, 失败不阻塞退出)。
    // 移植自旧 renderer.js collabLogout(~4273): await stopSenderBecauseAccountOffline。
    // 注意: 4002/4003/静默重登失败时的 stopSender 归 chat 域 (useChat.ts), 本域只管主动退出。
    await api.stopSender().catch(() => {})
    await api.closeAllAiWorkspaces().catch(() => {})
    const currentPrincipalId = useNotesAiStore.getState().principalId
    if (currentPrincipalId) {
      await api
        .setAiComposerEligibility({ principalId: currentPrincipalId, eligible: false })
        .catch(() => {})
    }
    await clearRemoteRouteState().catch(() => {})
    const local = await api.clearSettingsPrincipal().catch(() => null)
    if (local?.settings) {
      settingsPrincipalRuntime.activate(local.principalId)
      const localSettings = local.settings as unknown as AppSettings
      useAppStore.setState({ settings: localSettings })
      useTranslationStore.getState().resetForPrincipal(local.principalId, localSettings.translation)
      useNotesAiStore.getState().resetForPrincipal(local.principalId, localSettings.translation)
    } else {
      useTranslationStore.getState().resetForPrincipal('')
      useNotesAiStore.getState().invalidatePrincipal()
    }

    clearSession()
    setAuthed(false)

    // 清空聊天身份的 token (令 useChat 关闭 WS), 但保留本地历史 (messagesByConversation)
    // 与 serverUrl/username 预填语义。setIdentity 只改 identity 切片, 不动历史。
    // (对应旧 renderer.js collabLogout ~4267: 断开 socket、清 token、保留历史。)
    useChatStore.getState().setIdentity({ token: '' })
    useChatStore.getState().setConnection('idle')

    // 退出时保留 last_username / saved_password 以便下次预填; 仅清空头像缓存语义可选。
    void profile
  }, [clearSession, setAuthed])

  return { login, logout }
}
