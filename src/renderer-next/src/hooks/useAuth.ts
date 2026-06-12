import { useCallback } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore, type AuthProfile } from '@/store/useAuthStore'

// 协作服务器登录/退出逻辑 (移植自旧 renderer.js performCollabLogin / collabLogout)。
// 端点 (渲染层直连协作服务器, 非 IPC):
//   POST {server}/api/login   body: { username, password, client }  -> { token, profile:{avatar,displayName}, ... }
//   POST {server}/api/logout  header: Authorization: Bearer <token>
//
// 登录成功后: 写 useAuthStore(token/profile/runtimePassword)、useAppStore.setAuthed(true)、
//   持久化 collab.* 设置 (server_url / last_username / last_avatar / remember_password / saved_password)。

const LOGIN_TIMEOUT_MS = 10000
const LOGOUT_TIMEOUT_MS = 5000

export interface LoginParams {
  serverUrl: string
  username: string
  password: string
  rememberPassword: boolean
}

interface LoginResponse {
  token?: string
  profile?: { avatar?: string; displayName?: string }
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

// 与旧 renderer.js getClientVersionPayload 对齐 (服务器据此记录客户端信息)。
function clientVersionPayload(): Record<string, unknown> {
  const meta = useAppStore.getState().meta
  return {
    name: String(meta.name ?? 'ShareGPT'),
    version: String(meta.version ?? ''),
    platform: String(meta.platform ?? api.platform ?? ''),
    arch: String(meta.arch ?? ''),
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

      const response = await fetchWithTimeout(
        `${cleanedServer}/api/login`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: cleanedUser,
            password,
            client: clientVersionPayload(),
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

      const profile: AuthProfile = {
        username: cleanedUser,
        displayName: (payload.profile?.displayName ?? '').trim() || cleanedUser,
        avatar: (payload.profile?.avatar ?? '').trim(),
      }

      setSession({ token: payload.token, profile, password })

      // 持久化 collab 设置 (与旧版 settings.json 字段 100% 兼容)。
      await patchSection('collab', {
        server_url: cleanedServer,
        last_username: cleanedUser,
        last_avatar: profile.avatar,
        remember_password: rememberPassword,
        saved_password: rememberPassword ? password : '',
      })

      setAuthed(true)
      return profile
    },
    [patchSection, setAuthed, setSession],
  )

  const logout = useCallback(async () => {
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

    clearSession()
    setAuthed(false)
    // 退出时保留 last_username / saved_password 以便下次预填; 仅清空头像缓存语义可选。
    void profile
  }, [clearSession, setAuthed])

  return { login, logout }
}
