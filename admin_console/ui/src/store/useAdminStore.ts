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
} from '@/types/admin'

const THEME_KEY = 'sharegpt-admin-theme'
const AUTOREFRESH_KEY = 'sharegpt-admin-autorefresh'

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

const EMPTY_BOOTSTRAP: Bootstrap = { sender: {}, update: {}, extra: {} }

function clearedServerScope() {
  return {
    role: 'none' as const,
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
    activeTab: 'overview' as AdminTab,
  }
}

export const useAdminStore = create<AdminState>((set, get) => {
  let sessionGeneration = 0

  // 统一请求封装: 注入 serverUrl/token; 鉴权失效自动登出回登录页。
  async function request<T>(
    pathname: string,
    options?: RequestInit,
  ): Promise<{ value: T; generation: number }> {
    const { serverUrl, token } = get()
    const generation = sessionGeneration
    try {
      const value = await serverFetch<T>(serverUrl, token, pathname, options)
      return { value, generation }
    } catch (err) {
      if (err instanceof AuthExpiredError && generation === sessionGeneration) {
        forceLogout(err.message)
      }
      throw err
    }
  }

  function forceLogout(message?: string) {
    sessionGeneration += 1
    set(clearedServerScope())
    if (message) toast.error(message)
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
      applyTheme(get().dark)
      const generation = sessionGeneration
      const prefs = await adminApi.loadPrefs().catch(() => ({ serverUrl: '', username: '' }))
      if (generation === sessionGeneration) {
        set({ serverUrl: prefs.serverUrl || '', username: prefs.username || '' })
      }
    },

    login: async (serverUrl, username, password) => {
      const base = normalizeServerUrl(serverUrl)
      if (!base || !username || !password) {
        throw new Error('请先填写完整的服务地址、管理员账号和密码')
      }
      const generation = ++sessionGeneration
      set({ ...clearedServerScope(), serverUrl: base, username, busy: true })
      try {
        const res = await fetch(`${base}/api/admin/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        })
        const text = await res.text()
        if (!res.ok) throw new Error(text || `登录失败（${res.status}）`)
        const payload = (text ? JSON.parse(text) : {}) as {
          token?: string
          profile?: AdminProfile
        }
        if (generation !== sessionGeneration) return
        set({
          serverUrl: base,
          username,
          token: String(payload.token || ''),
          profile: payload.profile || null,
          authed: true,
          role: 'admin',
        })
        await adminApi.savePrefs({ serverUrl: base, username })
        if (generation !== sessionGeneration) return
        await Promise.all([
          get().loadUsers({ silent: true }),
          get().loadBootstrap({ silent: true }),
          get().loadProxyRoutes({ silent: true }),
          get().loadProxyRouteHealth({ silent: true }),
        ])
      } finally {
        if (generation === sessionGeneration) set({ busy: false })
      }
    },

    setupFirstAdmin: async (serverUrl, username, password) => {
      const base = normalizeServerUrl(serverUrl)
      if (!base || !username || !password) {
        throw new Error('请先填写服务地址、管理员账号和密码')
      }
      const generation = ++sessionGeneration
      set({ ...clearedServerScope(), serverUrl: base, username, busy: true })
      try {
        const res = await fetch(`${base}/api/admin/setup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, displayName: username }),
        })
        const text = await res.text()
        if (!res.ok) throw new Error(text || `初始化失败（${res.status}）`)
        const payload = (text ? JSON.parse(text) : {}) as {
          token?: string
          profile?: AdminProfile
        }
        if (generation !== sessionGeneration) return
        set({
          serverUrl: base,
          username,
          token: String(payload.token || ''),
          profile: payload.profile || null,
          authed: true,
          role: 'admin',
        })
        await adminApi.savePrefs({ serverUrl: base, username })
        if (generation !== sessionGeneration) return
        await Promise.all([
          get().loadUsers({ silent: true }),
          get().loadBootstrap({ silent: true }),
          get().loadProxyRoutes({ silent: true }),
          get().loadProxyRouteHealth({ silent: true }),
        ])
        toast.success('管理员已初始化，可以直接开始管理服务器。')
      } finally {
        if (generation === sessionGeneration) set({ busy: false })
      }
    },

    logout: async () => {
      const { serverUrl, token } = get()
      sessionGeneration += 1
      set(clearedServerScope())
      try {
        await serverFetch(serverUrl, token, '/api/admin/logout', { method: 'POST' })
      } catch {
        /* 忽略登出请求失败 */
      }
    },

    loadUsers: async (opts) => {
      const generation = sessionGeneration
      set({ usersLoading: true })
      try {
        const response = await request<{ users?: AdminUser[] }>('/api/admin/users')
        if (response.generation === sessionGeneration) {
          set({ users: Array.isArray(response.value.users) ? response.value.users : [] })
        }
      } catch (err) {
        if (!opts?.silent && !(err instanceof AuthExpiredError)) {
          toast.error(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (generation === sessionGeneration) set({ usersLoading: false })
      }
    },

    createUser: async (input) => {
      const response = await request<{ user?: AdminUser }>('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (response.generation !== sessionGeneration) return null
      await get().loadUsers({ silent: true })
      return response.value.user || null
    },

    saveUser: async (username, input) => {
      const response = await request(`/api/admin/users/${encodeURIComponent(username)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (response.generation !== sessionGeneration) return
      await get().loadUsers({ silent: true })
    },

    loadBootstrap: async (opts) => {
      try {
        const response = await request<Bootstrap>('/api/admin/bootstrap')
        if (response.generation === sessionGeneration) {
          set({ bootstrap: { ...EMPTY_BOOTSTRAP, ...response.value } })
        }
      } catch (err) {
        if (!opts?.silent && !(err instanceof AuthExpiredError)) {
          toast.error(err instanceof Error ? err.message : String(err))
        }
      }
    },

    saveBootstrap: async (payload) => {
      const response = await request<{ bootstrap?: Bootstrap }>('/api/admin/bootstrap', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (response.generation !== sessionGeneration) return null
      const next = response.value.bootstrap
        ? { ...EMPTY_BOOTSTRAP, ...response.value.bootstrap }
        : null
      if (next) set({ bootstrap: next })
      return next
    },

    setBootstrap: (next) => set({ bootstrap: next }),

    loadFeedback: async (opts) => {
      const generation = sessionGeneration
      set({ feedbackLoading: true })
      try {
        const response = await request<{ feedback?: FeedbackItem[] }>('/api/admin/feedback')
        if (response.generation === sessionGeneration) {
          set({
            feedback: Array.isArray(response.value.feedback) ? response.value.feedback : [],
          })
        }
      } catch (err) {
        if (!opts?.silent && !(err instanceof AuthExpiredError)) {
          toast.error(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (generation === sessionGeneration) set({ feedbackLoading: false })
      }
    },

    loadProxyMissing: async (opts) => {
      const generation = sessionGeneration
      set({ proxyMissingLoading: true })
      try {
        const response = await request<{ domains?: ProxyMissingItem[] }>('/api/admin/proxy-missing')
        if (response.generation === sessionGeneration) {
          set({
            proxyMissing: Array.isArray(response.value.domains) ? response.value.domains : [],
          })
        }
      } catch (err) {
        if (!opts?.silent && !(err instanceof AuthExpiredError)) {
          toast.error(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (generation === sessionGeneration) set({ proxyMissingLoading: false })
      }
    },

    loadProxyRoutes: async (opts) => {
      const generation = sessionGeneration
      set({ proxyRoutesLoading: true })
      try {
        const response = await request<ProxyRouteCatalog>('/api/admin/proxy-routes')
        if (response.generation === sessionGeneration) {
          set({
            proxyRoutes: Array.isArray(response.value.routes) ? response.value.routes : [],
          })
        }
      } catch (err) {
        if (!opts?.silent && !(err instanceof AuthExpiredError)) {
          toast.error(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (generation === sessionGeneration) set({ proxyRoutesLoading: false })
      }
    },

    saveProxyRoutes: async (routes) => {
      const response = await request<ProxyRouteCatalog>('/api/admin/proxy-routes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routes }),
      })
      if (response.generation !== sessionGeneration) return
      const savedRoutes = Array.isArray(response.value.routes) ? response.value.routes : []
      set({ proxyRoutes: savedRoutes })
      toast.success(`已下发 ${savedRoutes.length} 条内置线路`)
    },

    loadProxyRouteHealth: async (opts) => {
      try {
        const response = await request<{ reports?: ProxyRouteHealth[] }>(
          '/api/admin/proxy-route-health',
        )
        if (response.generation === sessionGeneration) {
          set({
            proxyRouteHealth: Array.isArray(response.value.reports) ? response.value.reports : [],
          })
        }
      } catch (err) {
        if (!opts?.silent && !(err instanceof AuthExpiredError)) {
          toast.error(err instanceof Error ? err.message : String(err))
        }
      }
    },

    // ===== 开发者 (全局发布) =====
    devLogin: async (serverUrl, key) => {
      const base = normalizeServerUrl(serverUrl)
      if (!base || !key) throw new Error('请填写服务地址和开发者密钥')
      const generation = ++sessionGeneration
      set({ ...clearedServerScope(), serverUrl: base, busy: true })
      try {
        const res = await fetch(`${base}/api/dev/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        })
        const text = await res.text()
        if (!res.ok) throw new Error(text || `开发者登录失败（${res.status}）`)
        const payload = (text ? JSON.parse(text) : {}) as {
          token?: string
          release?: SharedRelease
        }
        if (generation !== sessionGeneration) return
        set({
          role: 'dev',
          serverUrl: base,
          devToken: String(payload.token || ''),
          release: payload.release || null,
        })
        await adminApi.savePrefs({ serverUrl: base, username: get().username })
      } finally {
        if (generation === sessionGeneration) set({ busy: false })
      }
    },

    devLogout: async () => {
      const { serverUrl, devToken } = get()
      sessionGeneration += 1
      set(clearedServerScope())
      try {
        await serverFetch(serverUrl, devToken, '/api/dev/logout', { method: 'POST' })
      } catch {
        /* 忽略 */
      }
    },

    loadDevRelease: async () => {
      const { serverUrl, devToken } = get()
      const generation = sessionGeneration
      try {
        const res = await serverFetch<{ release?: SharedRelease }>(
          serverUrl,
          devToken,
          '/api/dev/release',
        )
        if (generation === sessionGeneration && res.release) set({ release: res.release })
      } catch (err) {
        if (err instanceof AuthExpiredError && generation === sessionGeneration) {
          forceLogout()
          toast.error('开发者登录已失效，请重新登录')
        } else if (generation === sessionGeneration) {
          toast.error(err instanceof Error ? err.message : String(err))
        }
      }
    },

    saveDevReleaseInfo: async (patch) => {
      const { serverUrl, devToken } = get()
      const generation = sessionGeneration
      const res = await serverFetch<{ release?: SharedRelease }>(
        serverUrl,
        devToken,
        '/api/dev/release',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        },
      )
      if (generation === sessionGeneration && res.release) set({ release: res.release })
    },
  }
})
