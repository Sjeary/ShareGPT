import { create } from 'zustand'
import { toast } from 'sonner'
import { adminApi, serverFetch, normalizeServerUrl } from '@/lib/api'
import {
  AuthExpiredError,
  type AdminProfile,
  type AdminTab,
  type AdminUser,
  type Bootstrap,
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
}

interface SaveUserInput {
  displayName?: string
  password?: string
  avatar?: string
  bio?: string
  isAdmin?: boolean
  disabled?: boolean
}

interface AdminState {
  // 主题
  dark: boolean
  toggleTheme: () => void

  // 连接 / 鉴权
  serverUrl: string
  username: string
  token: string
  profile: AdminProfile | null
  authed: boolean
  busy: boolean

  // 数据
  users: AdminUser[]
  usersLoading: boolean
  bootstrap: Bootstrap | null

  // 导航 / 偏好
  activeTab: AdminTab
  setActiveTab: (tab: AdminTab) => void
  autoRefresh: boolean
  setAutoRefresh: (v: boolean) => void

  // 动作
  init: () => Promise<void>
  login: (serverUrl: string, username: string, password: string) => Promise<void>
  setupFirstAdmin: (
    serverUrl: string,
    username: string,
    password: string,
  ) => Promise<void>
  logout: () => Promise<void>
  loadUsers: (opts?: { silent?: boolean }) => Promise<void>
  createUser: (input: CreateUserInput) => Promise<AdminUser | null>
  saveUser: (username: string, input: SaveUserInput) => Promise<void>
  loadBootstrap: (opts?: { silent?: boolean }) => Promise<void>
  saveBootstrap: (payload: Bootstrap) => Promise<Bootstrap | null>
  setBootstrap: (next: Bootstrap) => void
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

    serverUrl: '',
    username: '',
    token: '',
    profile: null,
    authed: false,
    busy: false,

    users: [],
    usersLoading: false,
    bootstrap: null,

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
        })
        await adminApi.savePrefs({ serverUrl: base, username })
        await Promise.all([get().loadUsers({ silent: true }), get().loadBootstrap({ silent: true })])
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
        })
        await adminApi.savePrefs({ serverUrl: base, username })
        await Promise.all([get().loadUsers({ silent: true }), get().loadBootstrap({ silent: true })])
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
  }
})
