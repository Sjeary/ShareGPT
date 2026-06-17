import { create } from 'zustand'
import { api } from '@/lib/api'
import type { NavKey } from '@/lib/nav'
import type { AppSettings, StatusPayload } from '@/types/settings'

interface AppState {
  // 导航
  active: NavKey
  setActive: (key: NavKey) => void

  // 主题
  dark: boolean
  toggleTheme: () => void

  // 侧栏收起 (图标轨)
  sidebarCollapsed: boolean
  toggleSidebar: () => void

  // 侧栏位置 (左/右), 为对称给用户选择 (设置项, 入口在账户面板)
  sidebarSide: 'left' | 'right'
  setSidebarSide: (side: 'left' | 'right') => void

  // AI 网页沉浸全屏: 隐藏侧栏与面板头, 最大化内嵌网页区
  aiImmersive: boolean
  setAiImmersive: (v: boolean) => void

  // 应用信息
  mode: string
  meta: Record<string, unknown>

  // 数据
  settings: AppSettings | null
  status: StatusPayload

  // 协作登录态 (true = 已登录到协作服务器)
  authed: boolean
  setAuthed: (v: boolean) => void

  // 动作
  init: () => Promise<void>
  reloadSettings: () => Promise<AppSettings>
  saveSettings: (next: AppSettings) => Promise<void>
  patchSection: <K extends keyof AppSettings>(
    section: K,
    patch: Partial<AppSettings[K]>,
  ) => Promise<void>
}

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark)
  try {
    localStorage.setItem('sharegpt-theme', dark ? 'dark' : 'light')
  } catch {
    /* ignore */
  }
}

const EMPTY_SETTINGS: AppSettings = {
  sender: {},
  receiver: {},
  collab: {},
  gpt: {},
  gemini: {},
  ui: {},
}

export const useAppStore = create<AppState>((set, get) => ({
  active: 'service',
  setActive: (key) => set({ active: key }),

  dark: (() => {
    try {
      return localStorage.getItem('sharegpt-theme') !== 'light'
    } catch {
      return true
    }
  })(),
  // 切换主题: 既写 localStorage (applyTheme 内), 也回写磁盘 settings.ui.theme,
  // 与旧版资料包保持一致 (旧 renderer.js ~159 state.ui.theme + 保存)。
  toggleTheme: () => {
    const next = !get().dark
    applyTheme(next)
    set({ dark: next })
    // 异步回写, 不阻塞 UI; 失败忽略 (localStorage 已兜底)。
    void get()
      .patchSection('ui', { theme: next ? 'dark' : 'light' })
      .catch(() => undefined)
  },

  sidebarCollapsed: (() => {
    try {
      return localStorage.getItem('sharegpt-sidebar') === '1'
    } catch {
      return false
    }
  })(),
  toggleSidebar: () =>
    set((s) => {
      const next = !s.sidebarCollapsed
      try {
        localStorage.setItem('sharegpt-sidebar', next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return { sidebarCollapsed: next }
    }),

  sidebarSide: (() => {
    try {
      return localStorage.getItem('sharegpt-sidebar-side') === 'right'
        ? 'right'
        : 'left'
    } catch {
      return 'left'
    }
  })(),
  // 设置侧栏左右: 写 localStorage (即时生效) + 回写磁盘 settings.ui.sidebarSide (跨设备一致)。
  setSidebarSide: (side) =>
    set((s) => {
      if (s.sidebarSide === side) return s
      try {
        localStorage.setItem('sharegpt-sidebar-side', side)
      } catch {
        /* ignore */
      }
      void get()
        .patchSection('ui', { sidebarSide: side })
        .catch(() => undefined)
      return { sidebarSide: side }
    }),

  aiImmersive: false,
  setAiImmersive: (v) => set({ aiImmersive: v }),

  mode: '',
  meta: {},
  settings: null,
  status: {},
  authed: false,
  setAuthed: (v) => set({ authed: v }),

  init: async () => {
    const [settings, mode, meta, status] = await Promise.all([
      api.loadSettings().catch(() => ({})),
      api.getMode().catch(() => 'all'),
      api.getAppMeta().catch(() => ({})),
      api.getStatus().catch(() => ({})),
    ])
    const mergedSettings = { ...EMPTY_SETTINGS, ...(settings as AppSettings) }
    set({
      settings: mergedSettings,
      mode: String(mode || ''),
      meta: meta as Record<string, unknown>,
      status: status as StatusPayload,
    })
    // [LOW] 主题优先取磁盘 settings.ui.theme (跨设备/资料包一致), 无则回退 localStorage 现值。
    const savedTheme = mergedSettings.ui?.theme
    if (savedTheme === 'dark' || savedTheme === 'light') {
      const dark = savedTheme === 'dark'
      applyTheme(dark)
      set({ dark })
    } else {
      // 无磁盘设置: 用启动时 localStorage 推断的 dark 重新落实到 DOM (确保 class 同步)。
      applyTheme(get().dark)
    }
    // 侧栏左右位置同样优先取磁盘设置 (跨设备一致), 无则保留 localStorage 现值。
    const savedSide = mergedSettings.ui?.sidebarSide
    if (savedSide === 'left' || savedSide === 'right') {
      set({ sidebarSide: savedSide })
    }
    api.onStatus((payload) => set({ status: payload as StatusPayload }))
  },

  reloadSettings: async () => {
    const raw = (await api.loadSettings().catch(() => ({}))) as AppSettings
    const merged = { ...EMPTY_SETTINGS, ...raw }
    set({ settings: merged })
    return merged
  },

  saveSettings: async (next) => {
    set({ settings: next })
    await api.saveSettings(next as unknown as Record<string, unknown>)
  },

  patchSection: async (section, patch) => {
    const cur = get().settings ?? EMPTY_SETTINGS
    const next: AppSettings = {
      ...cur,
      [section]: { ...(cur[section] as object), ...(patch as object) },
    }
    set({ settings: next })
    await api.saveSettings(next as unknown as Record<string, unknown>)
  },
}))
