import { useCallback } from 'react'
import { api } from '@/lib/api'
import {
  requireSettingsPrincipalSnapshot,
  settingsPrincipalRuntime,
} from '@/lib/settingsPrincipalRuntime'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore, type AuthProfile } from '@/store/useAuthStore'
import { useChatStore } from '@/store/useChatStore'
import { useNotesAiStore } from '@/store/useNotesAiStore'
import { useTranslationStore } from '@/store/useTranslationStore'
import { useAiStore } from '@/store/useAiStore'
import { normalizeChatMessage, normalizeDirectory } from '@/components/panels/chat/normalize'
import { discardCollabToken, refreshAuthoritativeClientBootstrap } from '@/hooks/clientBootstrap'
import { createLatestAttemptCoordinator } from '@/lib/latestAttempt'
import {
  completeCollabLoginTransaction,
  requireConfirmedLoginResponse,
} from '@/lib/collabLoginTransaction'
import type { AppSettings } from '@/types/settings'
import { requirePrincipalActivation, type PrincipalActivation } from '@/lib/principalActivation'

// 协作服务器登录/退出逻辑 (移植自旧 renderer.js performCollabLogin / collabLogout)。
// 端点 (渲染层直连协作服务器, 非 IPC):
//   POST {server}/api/login   body: { username, password, client }  -> { token, profile:{avatar,displayName}, ... }
//   POST {server}/api/logout  header: Authorization: Bearer <token>
//
// 登录成功后: 写 useAuthStore(token/profile/runtimePassword)、useAppStore.setAuthed(true)、
//   持久化 collab.* 设置 (server_url / last_username / last_avatar / remember_password / saved_password)。

const LOGIN_TIMEOUT_MS = 10000
const LOGOUT_TIMEOUT_MS = 5000
const loginAttempts = createLatestAttemptCoordinator()

function assertCurrentLoginAttempt(attempt: number): void {
  loginAttempts.assertCurrent(attempt)
}

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

export function useAuth() {
  const setAuthed = useAppStore((s) => s.setAuthed)
  const setWorkspaceMode = useAppStore((s) => s.setWorkspaceMode)
  const patchSection = useAppStore((s) => s.patchSection)
  const setSession = useAuthStore((s) => s.setSession)
  const clearSession = useAuthStore((s) => s.clearSession)

  const login = useCallback(
    async ({ serverUrl, username, password, rememberPassword }: LoginParams) => {
      const attempt = loginAttempts.begin()
      const cleanedServer = trimTrailingSlash(serverUrl.trim())
      const cleanedUser = username.trim()

      if (!cleanedServer || !cleanedUser || !password) {
        throw new Error('请先填写完整的服务地址、账号和密码')
      }
      if (!/^https?:\/\//i.test(cleanedServer)) {
        throw new Error('服务地址需要以 http:// 或 https:// 开头')
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
      assertCurrentLoginAttempt(attempt)

      const payload = await requireConfirmedLoginResponse<
        LoginResponse & { token: string; username: string }
      >(response)
      const issuedToken = payload.token
      if (!loginAttempts.isCurrent(attempt)) {
        await discardCollabToken(cleanedServer, issuedToken).catch(() => undefined)
        assertCurrentLoginAttempt(attempt)
      }
      const confirmedUsername = payload.username.trim()

      // 凭据已被服务器确认；先撤下旧会话和 WS，避免旧账号在 Principal 切换期间继续运行。
      clearSession()
      useChatStore.getState().setIdentity({ token: '' })
      setAuthed(false)

      const profile: AuthProfile = {
        username: confirmedUsername,
        displayName: (payload.profile?.displayName ?? '').trim() || confirmedUsername,
        avatar: (payload.profile?.avatar ?? '').trim(),
        isAdmin: Boolean(payload.profile?.isAdmin),
        advancedAiAllowed: Boolean(payload.profile?.isAdmin || payload.profile?.advancedAiAllowed),
        allowedProxyRouteIds: Array.isArray(payload.profile?.allowedProxyRouteIds)
          ? payload.profile.allowedProxyRouteIds
          : [],
        chatDisabled: Boolean(payload.profile?.chatDisabled),
      }

      let principalSnapshot: { principalId: string; generation: number } | null = null
      await completeCollabLoginTransaction<PrincipalActivation>({
        isCurrent: () => loginAttempts.isCurrent(attempt),
        assertCurrent: async () => {
          assertCurrentLoginAttempt(attempt)
          if (principalSnapshot) settingsPrincipalRuntime.assertCurrent(principalSnapshot)
        },
        activatePrincipal: async () => {
          // Principal 必须来自服务器确认的精确账号。先切换主进程设置所有权，
          // 再公开 token，避免 A 的配置短暂进入 B 的会话。
          // 任何上一工作区的 sender 都必须先停止，避免个人代理继续承载组织会话。
          await api.stopSender()
          settingsPrincipalRuntime.invalidate()
          useAiStore.getState().resetRuntime()
          useNotesAiStore.getState().invalidatePrincipal()
          const activation = requirePrincipalActivation(
            await api.activateSettingsPrincipal({
              serverUrl: cleanedServer,
              username: confirmedUsername,
            }),
          )
          return activation
        },
        applyPrincipal: (principal) => {
          principalSnapshot = settingsPrincipalRuntime.activate(
            principal.principalId,
            principal.generation,
          )
          const principalSettings = principal.settings as unknown as AppSettings
          useAppStore.setState({ settings: principalSettings })
          useTranslationStore
            .getState()
            .resetForPrincipal(principal.principalId, principalSettings.translation)
          useNotesAiStore
            .getState()
            .resetForPrincipal(principal.principalId, principalSettings.translation)
        },
        persistPrincipalSettings: async () => {
          // 与旧版 settings.json 字段 100% 兼容。
          await patchSection('collab', {
            server_url: cleanedServer,
            last_username: confirmedUsername,
            last_avatar: profile.avatar,
            remember_password: rememberPassword,
            auto_login: rememberPassword,
            saved_password: rememberPassword ? password : '',
          })
        },
        enableAdminCapabilities: async () => {
          const advancedAi = useAppStore.getState().settings?.advancedAi
          if (profile.isAdmin && advancedAi && !advancedAi.initialized) {
            await patchSection('advancedAi', {
              initialized: true,
              enabled: true,
            })
          }
        },
        refreshProxyAuthorization: () => {
          if (!principalSnapshot) throw new Error('线路授权缺少账号上下文')
          return refreshAuthoritativeClientBootstrap(cleanedServer, issuedToken, {
            allowLegacyAdminConfig: profile.isAdmin,
            principalSnapshot,
          }).then(() => undefined)
        },
        reportProxyAuthorizationFailure: (error) => {
          // 线路授权仍 fail closed，但它不是协作认证。聊天和账号保持登录，AI/代理入口读取
          // 已清空的 authorized_proxy_route_ids，并可在后续 bootstrap/重连时恢复。
          console.warn('Collaboration login continued without proxy authorization', error)
        },
        publishSession: () => {
          setSession({ token: issuedToken, profile, password })
          useChatStore.getState().setIdentity({
            serverUrl: cleanedServer,
            token: issuedToken,
            username: confirmedUsername,
            displayName: profile.displayName,
            avatar: profile.avatar,
          })
          if (Array.isArray(payload.history) && payload.history.length) {
            useChatStore
              .getState()
              .mergeMessages(payload.history.map((m) => normalizeChatMessage(m)))
          }
          const rawUsers = Array.isArray(payload.users)
            ? payload.users
            : Array.isArray(payload.onlineUsers)
              ? payload.onlineUsers
              : null
          if (rawUsers) useChatStore.getState().setDirectory(normalizeDirectory(rawUsers))
          setAuthed(true)
        },
        rollbackLocalPrincipal: async () => {
          const current = requireSettingsPrincipalSnapshot(await api.getSettingsPrincipal())
          let local: PrincipalActivation
          try {
            local = requirePrincipalActivation(
              await api.clearSettingsPrincipal({
                expectedPrincipalId: current.principalId,
                expectedPrincipalGeneration: current.generation,
              }),
            )
          } catch (error) {
            const settings = (await api.loadSettings({
              expectedPrincipalId: current.principalId,
              expectedPrincipalGeneration: current.generation,
            })) as unknown as AppSettings
            settingsPrincipalRuntime.activate(current.principalId, current.generation)
            useAppStore.setState({ settings })
            useTranslationStore
              .getState()
              .resetForPrincipal(current.principalId, settings.translation)
            useNotesAiStore.getState().resetForPrincipal(current.principalId, settings.translation)
            throw error
          }
          clearSession()
          setAuthed(false)
          useChatStore.getState().setIdentity({ token: '' })
          useChatStore.getState().setConnection('idle')
          settingsPrincipalRuntime.invalidate()
          useAiStore.getState().resetRuntime()
          useNotesAiStore.getState().invalidatePrincipal()
          settingsPrincipalRuntime.activate(local.principalId, local.generation)
          const localSettings = local.settings as unknown as AppSettings
          useAppStore.setState({ settings: localSettings })
          useTranslationStore
            .getState()
            .resetForPrincipal(local.principalId, localSettings.translation)
          useNotesAiStore.getState().resetForPrincipal(local.principalId, localSettings.translation)
        },
        rollbackActivatedPrincipalIfOwned: async (activated) => {
          let local: PrincipalActivation
          try {
            local = requirePrincipalActivation(
              await api.clearSettingsPrincipal({
                expectedPrincipalId: activated.principalId,
                expectedPrincipalGeneration: activated.generation,
              }),
            )
          } catch (error) {
            const current = requireSettingsPrincipalSnapshot(await api.getSettingsPrincipal())
            if (
              current.principalId !== activated.principalId ||
              current.generation !== activated.generation
            ) {
              return
            }
            throw error
          }
          clearSession()
          setAuthed(false)
          useChatStore.getState().setIdentity({ token: '' })
          useChatStore.getState().setConnection('idle')
          settingsPrincipalRuntime.invalidate()
          useAiStore.getState().resetRuntime()
          useNotesAiStore.getState().invalidatePrincipal()
          settingsPrincipalRuntime.activate(local.principalId, local.generation)
          const localSettings = local.settings as unknown as AppSettings
          useAppStore.setState({ settings: localSettings })
          useTranslationStore
            .getState()
            .resetForPrincipal(local.principalId, localSettings.translation)
          useNotesAiStore.getState().resetForPrincipal(local.principalId, localSettings.translation)
        },
        discardIssuedToken: () => discardCollabToken(cleanedServer, issuedToken),
      })

      return profile
    },
    [clearSession, patchSection, setAuthed, setSession],
  )

  const logout = useCallback(async () => {
    loginAttempts.invalidate()
    // 主动退出只关闭自动登录，不删除记住的凭据、环境或浏览器数据。
    await useAppStore.getState().patchSection('collab', { auto_login: false })
    const { token, profile } = useAuthStore.getState()
    const serverUrl = trimTrailingSlash(
      String(useAppStore.getState().settings?.collab?.server_url ?? '').trim(),
    )

    const current = settingsPrincipalRuntime.snapshot()
    const local = requirePrincipalActivation(
      await api.clearSettingsPrincipal({
        expectedPrincipalId: current.principalId,
        expectedPrincipalGeneration: current.generation,
      }),
    )
    settingsPrincipalRuntime.invalidate()
    useAiStore.getState().resetRuntime()
    useNotesAiStore.getState().invalidatePrincipal()
    settingsPrincipalRuntime.activate(local.principalId, local.generation)
    const localSettings = local.settings as unknown as AppSettings
    useAppStore.setState({ settings: localSettings })
    useTranslationStore.getState().resetForPrincipal(local.principalId, localSettings.translation)
    useNotesAiStore.getState().resetForPrincipal(local.principalId, localSettings.translation)

    // 通知服务器下线 (best-effort, 失败不阻塞已经完成的本地退出)。
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

  const enterPersonal = useCallback(() => {
    // 入口选择必须赢过尚未完成的自动登录。已进入 Principal 事务的旧尝试会按
    // completeCollabLoginTransaction 的 ownership guard 回滚，不能反向切回组织工作区。
    loginAttempts.invalidate()
    setWorkspaceMode('personal')
  }, [setWorkspaceMode])

  return { login, logout, enterPersonal }
}
