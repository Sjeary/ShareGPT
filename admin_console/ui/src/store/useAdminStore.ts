import { create } from 'zustand'
import { toast } from 'sonner'
import { adminApi, serverFetch, normalizeServerUrl } from '@/lib/api'
import {
  AuthExpiredError,
  type AdminProfile,
  type AdminTab,
  type AdminUser,
  type ProxyRoute,
  type ProxyRouteCatalog,
  type ProxyRouteHealth,
  type Bootstrap,
  type FeedbackItem,
  type ProxyMissingItem,
  type SharedRelease,
  type AdminTranslationProfile,
  type TranslationProfileCatalog,
  type TranslationUsageReport,
  type AiServiceKind,
  type AiUsageReport,
} from '@/types/admin'

const THEME_KEY = 'sharegpt-admin-theme'
const AUTOREFRESH_KEY = 'sharegpt-admin-autorefresh'
let aiUsageRequestId = 0

interface CreateUserInput {
  username: string
  displayName: string
  password: string
  avatar: string
  bio: string
  isAdmin: boolean
  advancedAiAllowed: boolean
  allowedProxyRouteIds: string[]
  chatDisabled?: boolean
}

interface SaveUserInput {
  displayName?: string
  password?: string
  avatar?: string
  bio?: string
  isAdmin?: boolean
  advancedAiAllowed?: boolean
  allowedProxyRouteIds?: string[]
  disabled?: boolean
  chatDisabled?: boolean
}

interface AdminState {
  // 主题
  dark: boolean
  toggleTheme: () => void

  // 角色: none(未登录) / admin(群管理员) / dev(开发者全局发布)
  role: 'none' | 'admin' | 'dev'

  // 连接 / 鉴权
  serverUrl: string
  username: string
  token: string
  profile: AdminProfile | null
  authed: boolean
  busy: boolean

  // 开发者(全局发布)状态
  devToken: string
  release: SharedRelease | null

  // 数据
  users: AdminUser[]
  usersLoading: boolean
  bootstrap: Bootstrap | null
  feedback: FeedbackItem[]
  feedbackLoading: boolean
  proxyMissing: ProxyMissingItem[]
  proxyMissingLoading: boolean
  proxyRoutes: ProxyRoute[]
  proxyRoutesLoading: boolean
  proxyRouteHealth: ProxyRouteHealth[]
  translationCatalog: TranslationProfileCatalog | null
  translationLoading: boolean
  translationUsage: TranslationUsageReport | null
  translationUsageLoading: boolean
  aiUsage: AiUsageReport | null
  aiUsageLoading: boolean

  // 导航 / 偏好
  activeTab: AdminTab
  setActiveTab: (tab: AdminTab) => void
  autoRefresh: boolean
  setAutoRefresh: (v: boolean) => void

  // 动作
  init: () => Promise<void>
  login: (serverUrl: string, username: string, password: string) => Promise<void>
  setupFirstAdmin: (serverUrl: string, username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  loadUsers: (opts?: { silent?: boolean }) => Promise<void>
  createUser: (input: CreateUserInput) => Promise<AdminUser | null>
  saveUser: (username: string, input: SaveUserInput) => Promise<void>
  loadBootstrap: (opts?: { silent?: boolean }) => Promise<void>
  saveBootstrap: (payload: Bootstrap) => Promise<Bootstrap | null>
  setBootstrap: (next: Bootstrap) => void
  loadFeedback: (opts?: { silent?: boolean }) => Promise<void>
  loadProxyMissing: (opts?: { silent?: boolean }) => Promise<void>
  loadProxyRoutes: (opts?: { silent?: boolean }) => Promise<void>
  loadProxyRouteHealth: (opts?: { silent?: boolean }) => Promise<void>
  saveProxyRoutes: (routes: ProxyRoute[]) => Promise<void>
  loadTranslationProfiles: (opts?: { silent?: boolean }) => Promise<void>
  saveTranslationProfiles: (
    defaultProfileId: string,
    profiles: AdminTranslationProfile[],
  ) => Promise<void>
  loadTranslationUsage: (opts?: {
    silent?: boolean
    filters?: { from?: string; to?: string; username?: string; profileId?: string }
  }) => Promise<void>
  loadAiUsage: (opts?: {
    silent?: boolean
    filters?: { service?: AiServiceKind; from?: string; to?: string }
  }) => Promise<void>

  // 开发者(全局发布)
  devLogin: (serverUrl: string, key: string) => Promise<void>
  devLogout: () => Promise<void>
  loadDevRelease: () => Promise<void>
  saveDevReleaseInfo: (patch: { version?: string; notes?: string }) => Promise<void>
}

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark)
  try {
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
  } catch {
    /* ignore */
  }
}

const EMPTY_BOOTSTRAP: Bootstrap = {
  sender: {},
  update: {},
  aiRouting: {
    version: 1,
    defaultRouteByKind: { gpt: '', gemini: '', claude: '' },
    updatedAt: '',
  },
  extra: {},
}

export const useAdminStore = create<AdminState>((set, get) => {
  let generation = 0

  function clearSession() {
    generation += 1
    set({
      role: 'none',
      token: '',
      devToken: '',
      profile: null,
      authed: false,
      busy: false,
      release: null,
      users: [],
      usersLoading: false,
      bootstrap: null,
      feedback: [],
      feedbackLoading: false,
      proxyMissing: [],
      proxyMissingLoading: false,
      proxyRoutes: [],
      proxyRoutesLoading: false,
      proxyRouteHealth: [],
      translationCatalog: null,
      translationLoading: false,
      translationUsage: null,
      translationUsageLoading: false,
      aiUsage: null,
      aiUsageLoading: false,
      activeTab: 'overview',
    })
  }

  // Every async action owns the session that started it, including loading and
  // error feedback. Logout invalidates it immediately, before any network wait.
  function captureSession() {
    const started = generation
    const { serverUrl, token, devToken, role } = get()
    const isCurrent = () => started === generation
    return {
      isCurrent,
      set: (next: Partial<AdminState>) => {
        if (isCurrent()) set(next)
      },
      toast: {
        error: (message: string) => {
          if (isCurrent()) toast.error(message)
        },
        success: (message: string) => {
          if (isCurrent()) toast.success(message)
        },
      },
      async request<T>(pathname: string, options?: RequestInit): Promise<T | undefined> {
        if (!isCurrent()) return undefined
        try {
          const result = await serverFetch<T>(
            serverUrl,
            role === 'dev' ? devToken : token,
            pathname,
            options,
          )
          return isCurrent() ? result : undefined
        } catch (err) {
          if (!isCurrent()) return undefined
          if (err instanceof AuthExpiredError) {
            clearSession()
            toast.error(err.message)
          }
          throw err
        }
      },
    }
  }

  return {
    dark: (() => {
      try {
        return localStorage.getItem(THEME_KEY) !== 'light'
      } catch {
        return true
      }
    })(),
    toggleTheme: () => {
      const next = !get().dark
      applyTheme(next)
      set({ dark: next })
    },

    role: 'none',
    serverUrl: '',
    username: '',
    token: '',
    profile: null,
    authed: false,
    busy: false,
    devToken: '',
    release: null,

    users: [],
    usersLoading: false,
    bootstrap: null,
    feedback: [],
    feedbackLoading: false,
    proxyMissing: [],
    proxyMissingLoading: false,
    proxyRoutes: [],
    proxyRoutesLoading: false,
    proxyRouteHealth: [],
    translationCatalog: null,
    translationLoading: false,
    translationUsage: null,
    translationUsageLoading: false,
    aiUsage: null,
    aiUsageLoading: false,

    activeTab: 'overview',
    setActiveTab: (activeTab) => set({ activeTab }),
    autoRefresh: (() => {
      try {
        return localStorage.getItem(AUTOREFRESH_KEY) === '1'
      } catch {
        return false
      }
    })(),
    setAutoRefresh: (v) => {
      try {
        localStorage.setItem(AUTOREFRESH_KEY, v ? '1' : '0')
      } catch {
        /* ignore */
      }
      set({ autoRefresh: v })
    },

    init: async () => {
      const scope = captureSession()
      applyTheme(get().dark)
      const prefs = await adminApi.loadPrefs().catch(() => ({ serverUrl: '', username: '' }))
      scope.set({ serverUrl: prefs.serverUrl || '', username: prefs.username || '' })
    },

    login: async (serverUrl, username, password) => {
      const base = normalizeServerUrl(serverUrl)
      if (!base || !username || !password) {
        throw new Error('请先填写完整的服务地址、管理员账号和密码')
      }
      clearSession()
      const scope = captureSession()
      scope.set({ busy: true })
      try {
        const res = await fetch(`${base}/api/admin/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        })
        const text = await res.text()
        if (!scope.isCurrent()) return
        if (!res.ok) throw new Error(text || `登录失败（${res.status}）`)
        const payload = (text ? JSON.parse(text) : {}) as {
          token?: string
          profile?: AdminProfile
        }
        scope.set({
          serverUrl: base,
          username,
          token: String(payload.token || ''),
          profile: payload.profile || null,
          authed: true,
          role: 'admin',
        })
        await adminApi.savePrefs({ serverUrl: base, username })
        if (!scope.isCurrent()) return
        await Promise.all([
          get().loadUsers({ silent: true }),
          get().loadBootstrap({ silent: true }),
          get().loadProxyRoutes({ silent: true }),
          get().loadProxyRouteHealth({ silent: true }),
          get().loadTranslationProfiles({ silent: true }),
          get().loadTranslationUsage({ silent: true }),
        ])
      } catch (err) {
        if (scope.isCurrent()) throw err
      } finally {
        scope.set({ busy: false })
      }
    },

    setupFirstAdmin: async (serverUrl, username, password) => {
      const base = normalizeServerUrl(serverUrl)
      if (!base || !username || !password) {
        throw new Error('请先填写服务地址、管理员账号和密码')
      }
      clearSession()
      const scope = captureSession()
      scope.set({ busy: true })
      try {
        const res = await fetch(`${base}/api/admin/setup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, displayName: username }),
        })
        const text = await res.text()
        if (!scope.isCurrent()) return
        if (!res.ok) throw new Error(text || `初始化失败（${res.status}）`)
        const payload = (text ? JSON.parse(text) : {}) as {
          token?: string
          profile?: AdminProfile
        }
        scope.set({
          serverUrl: base,
          username,
          token: String(payload.token || ''),
          profile: payload.profile || null,
          authed: true,
          role: 'admin',
        })
        await adminApi.savePrefs({ serverUrl: base, username })
        if (!scope.isCurrent()) return
        await Promise.all([
          get().loadUsers({ silent: true }),
          get().loadBootstrap({ silent: true }),
          get().loadProxyRoutes({ silent: true }),
          get().loadProxyRouteHealth({ silent: true }),
          get().loadTranslationProfiles({ silent: true }),
          get().loadTranslationUsage({ silent: true }),
        ])
        scope.toast.success('管理员已初始化，可以直接开始管理服务器。')
      } catch (err) {
        if (scope.isCurrent()) throw err
      } finally {
        scope.set({ busy: false })
      }
    },

    logout: async () => {
      const scope = captureSession()
      const pending = scope.request('/api/admin/logout', { method: 'POST' })
      clearSession()
      await pending.catch(() => undefined)
    },

    loadUsers: async (opts) => {
      const scope = captureSession()
      scope.set({ usersLoading: true })
      try {
        const payload = await scope.request<{ users?: AdminUser[] }>('/api/admin/users')
        if (!payload) return
        scope.set({ users: Array.isArray(payload.users) ? payload.users : [] })
      } catch (err) {
        if (!opts?.silent && !(err instanceof AuthExpiredError)) {
          scope.toast.error(err instanceof Error ? err.message : String(err))
        }
      } finally {
        scope.set({ usersLoading: false })
      }
    },

    createUser: async (input) => {
      const scope = captureSession()
      const res = await scope.request<{ user?: AdminUser }>('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res) return null
      await get().loadUsers({ silent: true })
      return scope.isCurrent() ? res.user || null : null
    },

    saveUser: async (username, input) => {
      const scope = captureSession()
      await scope.request(`/api/admin/users/${encodeURIComponent(username)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!scope.isCurrent()) return
      await get().loadUsers({ silent: true })
    },

    loadBootstrap: async (opts) => {
      const scope = captureSession()
      try {
        const payload = await scope.request<Bootstrap>('/api/admin/bootstrap')
        if (!payload) return
        scope.set({ bootstrap: { ...EMPTY_BOOTSTRAP, ...payload } })
      } catch (err) {
        if (!opts?.silent && !(err instanceof AuthExpiredError)) {
          scope.toast.error(err instanceof Error ? err.message : String(err))
        }
      }
    },

    saveBootstrap: async (payload) => {
      const scope = captureSession()
      const res = await scope.request<{ bootstrap?: Bootstrap }>('/api/admin/bootstrap', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res) return null
      const next = res.bootstrap ? { ...EMPTY_BOOTSTRAP, ...res.bootstrap } : null
      if (next) scope.set({ bootstrap: next })
      return next
    },

    setBootstrap: (next) => set({ bootstrap: next }),

    loadFeedback: async (opts) => {
      const scope = captureSession()
      scope.set({ feedbackLoading: true })
      try {
        const payload = await scope.request<{ feedback?: FeedbackItem[] }>('/api/admin/feedback')
        if (!payload) return
        scope.set({ feedback: Array.isArray(payload.feedback) ? payload.feedback : [] })
      } catch (err) {
        if (!opts?.silent && !(err instanceof AuthExpiredError)) {
          scope.toast.error(err instanceof Error ? err.message : String(err))
        }
      } finally {
        scope.set({ feedbackLoading: false })
      }
    },

    loadProxyMissing: async (opts) => {
      const scope = captureSession()
      scope.set({ proxyMissingLoading: true })
      try {
        const payload = await scope.request<{ domains?: ProxyMissingItem[] }>(
          '/api/admin/proxy-missing',
        )
        if (!payload) return
        scope.set({ proxyMissing: Array.isArray(payload.domains) ? payload.domains : [] })
      } catch (err) {
        if (!opts?.silent && !(err instanceof AuthExpiredError)) {
          scope.toast.error(err instanceof Error ? err.message : String(err))
        }
      } finally {
        scope.set({ proxyMissingLoading: false })
      }
    },

    loadProxyRoutes: async (opts) => {
      const scope = captureSession()
      scope.set({ proxyRoutesLoading: true })
      try {
        const payload = await scope.request<ProxyRouteCatalog>('/api/admin/proxy-routes')
        if (!payload) return
        scope.set({ proxyRoutes: Array.isArray(payload.routes) ? payload.routes : [] })
      } catch (err) {
        if (!opts?.silent && !(err instanceof AuthExpiredError)) {
          scope.toast.error(err instanceof Error ? err.message : String(err))
        }
      } finally {
        scope.set({ proxyRoutesLoading: false })
      }
    },

    saveProxyRoutes: async (routes) => {
      const scope = captureSession()
      const res = await scope.request<ProxyRouteCatalog>('/api/admin/proxy-routes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routes }),
      })
      if (!res) return
      scope.set({ proxyRoutes: Array.isArray(res.routes) ? res.routes : [] })
      scope.toast.success(`已下发 ${Array.isArray(res.routes) ? res.routes.length : 0} 条内置线路`)
    },

    loadProxyRouteHealth: async (opts) => {
      const scope = captureSession()
      try {
        const payload = await scope.request<{ reports?: ProxyRouteHealth[] }>(
          '/api/admin/proxy-route-health',
        )
        if (!payload) return
        scope.set({ proxyRouteHealth: Array.isArray(payload.reports) ? payload.reports : [] })
      } catch (err) {
        if (!opts?.silent && !(err instanceof AuthExpiredError)) {
          scope.toast.error(err instanceof Error ? err.message : String(err))
        }
      }
    },

    loadTranslationProfiles: async (opts) => {
      const scope = captureSession()
      scope.set({ translationLoading: true })
      try {
        const payload = await scope.request<TranslationProfileCatalog>(
          '/api/admin/translation-profiles',
        )
        if (!payload) return
        scope.set({ translationCatalog: payload })
      } catch (err) {
        if (!opts?.silent && !(err instanceof AuthExpiredError)) {
          scope.toast.error(err instanceof Error ? err.message : String(err))
        }
      } finally {
        scope.set({ translationLoading: false })
      }
    },

    saveTranslationProfiles: async (defaultProfileId, profiles) => {
      const scope = captureSession()
      const payload = await scope.request<TranslationProfileCatalog>(
        '/api/admin/translation-profiles',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultProfileId, profiles }),
        },
      )
      if (!payload) return
      scope.set({ translationCatalog: payload })
      scope.toast.success('托管翻译配置已保存')
    },

    loadTranslationUsage: async (opts) => {
      const scope = captureSession()
      scope.set({ translationUsageLoading: true })
      try {
        const query = new URLSearchParams()
        if (opts?.filters?.from) query.set('from', opts.filters.from)
        if (opts?.filters?.to) query.set('to', opts.filters.to)
        if (opts?.filters?.username) query.set('username', opts.filters.username)
        if (opts?.filters?.profileId) query.set('profileId', opts.filters.profileId)
        const payload = await scope.request<TranslationUsageReport>(
          `/api/admin/translation-usage${query.size ? `?${query.toString()}` : ''}`,
        )
        if (!payload) return
        scope.set({ translationUsage: payload })
      } catch (err) {
        if (!opts?.silent && !(err instanceof AuthExpiredError)) {
          scope.toast.error(err instanceof Error ? err.message : String(err))
        }
      } finally {
        scope.set({ translationUsageLoading: false })
      }
    },

    loadAiUsage: async (opts) => {
      const scope = captureSession()
      const requestId = ++aiUsageRequestId
      scope.set({ aiUsageLoading: true })
      try {
        const query = new URLSearchParams()
        query.set('service', opts?.filters?.service || 'gpt')
        if (opts?.filters?.from) query.set('from', opts.filters.from)
        if (opts?.filters?.to) query.set('to', opts.filters.to)
        const payload = await scope.request<AiUsageReport>(
          `/api/admin/ai-usage?${query.toString()}`,
        )
        if (!payload) return
        if (requestId === aiUsageRequestId) scope.set({ aiUsage: payload })
      } catch (err) {
        if (!opts?.silent && !(err instanceof AuthExpiredError)) {
          scope.toast.error(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (requestId === aiUsageRequestId) scope.set({ aiUsageLoading: false })
      }
    },

    // ===== 开发者 (全局发布) =====
    devLogin: async (serverUrl, key) => {
      const base = normalizeServerUrl(serverUrl)
      if (!base || !key) throw new Error('请填写服务地址和开发者密钥')
      clearSession()
      const scope = captureSession()
      scope.set({ busy: true })
      try {
        const res = await fetch(`${base}/api/dev/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        })
        const text = await res.text()
        if (!scope.isCurrent()) return
        if (!res.ok) throw new Error(text || `开发者登录失败（${res.status}）`)
        const payload = (text ? JSON.parse(text) : {}) as {
          token?: string
          release?: SharedRelease
        }
        scope.set({
          role: 'dev',
          serverUrl: base,
          devToken: String(payload.token || ''),
          release: payload.release || null,
        })
        await adminApi.savePrefs({ serverUrl: base, username: get().username })
      } catch (err) {
        if (scope.isCurrent()) throw err
      } finally {
        scope.set({ busy: false })
      }
    },

    devLogout: async () => {
      const scope = captureSession()
      const pending = scope.request('/api/dev/logout', { method: 'POST' })
      clearSession()
      await pending.catch(() => undefined)
    },

    loadDevRelease: async () => {
      const scope = captureSession()
      try {
        const res = await scope.request<{ release?: SharedRelease }>('/api/dev/release')
        if (!res) return
        if (res.release) scope.set({ release: res.release })
      } catch (err) {
        if (err instanceof AuthExpiredError) {
          // The request owner already cleared the expired session.
        } else {
          scope.toast.error(err instanceof Error ? err.message : String(err))
        }
      }
    },

    saveDevReleaseInfo: async (patch) => {
      const scope = captureSession()
      const res = await scope.request<{ release?: SharedRelease }>('/api/dev/release', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res) return
      if (res.release) scope.set({ release: res.release })
    },
  }
})
