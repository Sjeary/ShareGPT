import { create } from 'zustand'
import { toast } from 'sonner'
import { adminApi, serverFetch, normalizeServerUrl } from '@/lib/api'
import {
  AuthExpiredError,
  type AdminProfile,
  type AdminTab,
  type AdminUser,
  type Airport,
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
  chatDisabled?: boolean
}

interface SaveUserInput {
  displayName?: string
  password?: string
  avatar?: string
  bio?: string
  isAdmin?: boolean
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
  airport: Airport | null
  airportLoading: boolean

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
  loadAirport: (opts?: { silent?: boolean }) => Promise<void>
  saveAirport: (name: string, outbound: Record<string, unknown> | null) => Promise<void>

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

export const useAdminStore = create<AdminState>((set, get) => {
  // 统一请求封装: 注入 serverUrl/token; 鉴权失效自动登出回登录页。
  async function request<T>(pathname: string, options?: RequestInit): Promise<T> {
    const { serverUrl, token } = get()
    try {
      return await serverFetch<T>(serverUrl, token, pathname, options)
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        forceLogout(err.message)
      }
      throw err
    }
  }

  function forceLogout(message?: string) {
    if (!get().authed && !get().token) return
    set({
      role: 'none',
      token: '',
      profile: null,
      authed: false,
      users: [],
      bootstrap: null,
    })
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
    airport: null,
    airportLoading: false,

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
      const prefs = await adminApi.loadPrefs().catch(() => ({ serverUrl: '', username: '' }))
      set({ serverUrl: prefs.serverUrl || '', username: prefs.username || '' })
    },

    login: async (serverUrl, username, password) => {
      const base = normalizeServerUrl(serverUrl)
      if (!base || !username || !password) {
        throw new Error('请先填写完整的服务地址、管理员账号和密码')
      }
      set({ busy: true })
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
        set({
          serverUrl: base,
          username,
          token: String(payload.token || ''),
          profile: payload.profile || null,
          authed: true,
          role: 'admin',
        })
        await adminApi.savePrefs({ serverUrl: base, username })
        await Promise.all([
          get().loadUsers({ silent: true }),
          get().loadBootstrap({ silent: true }),
        ])
      } finally {
        set({ busy: false })
      }
    },

    setupFirstAdmin: async (serverUrl, username, password) => {
      const base = normalizeServerUrl(serverUrl)
      if (!base || !username || !password) {
        throw new Error('请先填写服务地址、管理员账号和密码')
      }
      set({ busy: true })
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
        set({
          serverUrl: base,
          username,
          token: String(payload.token || ''),
          profile: payload.profile || null,
          authed: true,
          role: 'admin',
        })
        await adminApi.savePrefs({ serverUrl: base, username })
        await Promise.all([
          get().loadUsers({ silent: true }),
          get().loadBootstrap({ silent: true }),
        ])
        toast.success('管理员已初始化，可以直接开始管理服务器。')
      } finally {
        set({ busy: false })
      }
    },

    logout: async () => {
      try {
        await request('/api/admin/logout', { method: 'POST' })
      } catch {
        /* 忽略登出请求失败 */
      }
      set({
        role: 'none',
        token: '',
        profile: null,
        authed: false,
        users: [],
        bootstrap: null,
        activeTab: 'overview',
      })
    },

    loadUsers: async (opts) => {
      set({ usersLoading: true })
      try {
        const payload = await request<{ users?: AdminUser[] }>('/api/admin/users')
        set({ users: Array.isArray(payload.users) ? payload.users : [] })
      } catch (err) {
        if (!opts?.silent && !(err instanceof AuthExpiredError)) {
          toast.error(err instanceof Error ? err.message : String(err))
        }
      } finally {
        set({ usersLoading: false })
      }
    },

    createUser: async (input) => {
      const res = await request<{ user?: AdminUser }>('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      await get().loadUsers({ silent: true })
      return res.user || null
    },

    saveUser: async (username, input) => {
      await request(`/api/admin/users/${encodeURIComponent(username)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      await get().loadUsers({ silent: true })
    },

    loadBootstrap: async (opts) => {
      try {
        const payload = await request<Bootstrap>('/api/admin/bootstrap')
        set({ bootstrap: { ...EMPTY_BOOTSTRAP, ...payload } })
      } catch (err) {
        if (!opts?.silent && !(err instanceof AuthExpiredError)) {
          toast.error(err instanceof Error ? err.message : String(err))
        }
      }
    },

    saveBootstrap: async (payload) => {
      const res = await request<{ bootstrap?: Bootstrap }>('/api/admin/bootstrap', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const next = res.bootstrap ? { ...EMPTY_BOOTSTRAP, ...res.bootstrap } : null
      if (next) set({ bootstrap: next })
      return next
    },

    setBootstrap: (next) => set({ bootstrap: next }),

    loadFeedback: async (opts) => {
      set({ feedbackLoading: true })
      try {
        const payload = await request<{ feedback?: FeedbackItem[] }>('/api/admin/feedback')
        set({ feedback: Array.isArray(payload.feedback) ? payload.feedback : [] })
      } catch (err) {
        if (!opts?.silent && !(err instanceof AuthExpiredError)) {
          toast.error(err instanceof Error ? err.message : String(err))
        }
      } finally {
        set({ feedbackLoading: false })
      }
    },

    loadProxyMissing: async (opts) => {
      set({ proxyMissingLoading: true })
      try {
        const payload = await request<{ domains?: ProxyMissingItem[] }>('/api/admin/proxy-missing')
        set({ proxyMissing: Array.isArray(payload.domains) ? payload.domains : [] })
      } catch (err) {
        if (!opts?.silent && !(err instanceof AuthExpiredError)) {
          toast.error(err instanceof Error ? err.message : String(err))
        }
      } finally {
        set({ proxyMissingLoading: false })
      }
    },

    loadAirport: async (opts) => {
      set({ airportLoading: true })
      try {
        const payload = await request<Airport>('/api/admin/airport')
        set({ airport: payload && typeof payload === 'object' ? payload : null })
      } catch (err) {
        if (!opts?.silent && !(err instanceof AuthExpiredError)) {
          toast.error(err instanceof Error ? err.message : String(err))
        }
      } finally {
        set({ airportLoading: false })
      }
    },

    saveAirport: async (name, outbound) => {
      const res = await request<{ airport?: Airport }>('/api/admin/airport', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, outbound }),
      })
      if (res.airport) set({ airport: res.airport })
      toast.success(outbound ? '机场节点已下发' : '机场节点已清除')
    },

    // ===== 开发者 (全局发布) =====
    devLogin: async (serverUrl, key) => {
      const base = normalizeServerUrl(serverUrl)
      if (!base || !key) throw new Error('请填写服务地址和开发者密钥')
      set({ busy: true })
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
        set({
          role: 'dev',
          serverUrl: base,
          devToken: String(payload.token || ''),
          release: payload.release || null,
        })
        await adminApi.savePrefs({ serverUrl: base, username: get().username })
      } finally {
        set({ busy: false })
      }
    },

    devLogout: async () => {
      const { serverUrl, devToken } = get()
      try {
        await serverFetch(serverUrl, devToken, '/api/dev/logout', { method: 'POST' })
      } catch {
        /* 忽略 */
      }
      set({ role: 'none', devToken: '', release: null })
    },

    loadDevRelease: async () => {
      const { serverUrl, devToken } = get()
      try {
        const res = await serverFetch<{ release?: SharedRelease }>(
          serverUrl,
          devToken,
          '/api/dev/release',
        )
        if (res.release) set({ release: res.release })
      } catch (err) {
        if (err instanceof AuthExpiredError) {
          set({ role: 'none', devToken: '', release: null })
          toast.error('开发者登录已失效，请重新登录')
        } else {
          toast.error(err instanceof Error ? err.message : String(err))
        }
      }
    },

    saveDevReleaseInfo: async (patch) => {
      const { serverUrl, devToken } = get()
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
      if (res.release) set({ release: res.release })
    },
  }
})
