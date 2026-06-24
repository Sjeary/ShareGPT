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

  // 是否在导航栏展示 Gemini 入口 (设置项, 入口在账户面板)。默认展示。
  showGemini: boolean
  setShowGemini: (v: boolean) => void

  // 是否在导航栏展示 Claude 入口 (设置项, 入口在账户面板)。默认展示。
  showClaude: boolean
  setShowClaude: (v: boolean) => void

  // 可隐藏的内容导航入口 (ChatGPT / 个人日历 / 组队日历 / 待办 / 笔记 / 专注)。默认全部展示。
  hiddenNav: NavKey[]
  setNavHidden: (key: NavKey, hidden: boolean) => void

  // 用户自定义导航排序 (长按拖动重排得到)。空数组 = 用 NAV 默认顺序。
  navOrder: NavKey[]
  setNavOrder: (order: NavKey[]) => void

  // GPT/Gemini 页隐藏侧栏 (侧栏三态之一: 左 / 右 / 隐藏), 让内嵌网页占满看着清爽。
  // 仅在 GPT/Gemini 面板生效 (见 Shell), 避免在其它面板把导航藏没了。
  sidebarHidden: boolean
  setSidebarHidden: (v: boolean) => void
  toggleSidebarHidden: () => void

  // 应用信息
  mode: string
  meta: Record<string, unknown>

  // 数据
  settings: AppSettings | null
  status: StatusPayload

  // 协作登录态 (true = 已登录到协作服务器)
  authed: boolean
  setAuthed: (v: boolean) => void

  // 预览态 (true = 未登录但点了"先逛逛"进入只读主界面)。仅内存, 不持久化;
  // 登录成功后由 setAuthed 顺带清掉, 避免和登录态并存。
  previewMode: boolean
  setPreviewMode: (v: boolean) => void

  // 新手引导导览是否正在进行 (仅内存)。首次进入主界面自动开, 也可在标题栏「?」手动重开。
  tourOpen: boolean
  setTourOpen: (v: boolean) => void

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
  claude: {},
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
    // 内嵌网页(GPT/Gemini)明暗跟随 app 主题。
    void api.setThemeSource(next ? 'dark' : 'light').catch(() => undefined)
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
      return localStorage.getItem('sharegpt-sidebar-side') === 'right' ? 'right' : 'left'
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

  showGemini: (() => {
    try {
      // 默认隐藏: 仅当显式存为 '1' 时展示。
      // Gemini 依赖 Google 登录, 而内嵌客户端无法完成 Google 登录, 集成尝试未成功, 故默认隐藏。
      return localStorage.getItem('sharegpt-show-gemini') === '1'
    } catch {
      return false
    }
  })(),
  // 切换是否展示 Gemini: 写 localStorage + 回写磁盘 settings.ui.showGemini;
  // 若在 Gemini 页时被关闭, 自动切回「代理转发」, 避免停留在已隐藏的空面板。
  setShowGemini: (v) =>
    set((s) => {
      try {
        localStorage.setItem('sharegpt-show-gemini', v ? '1' : '0')
      } catch {
        /* ignore */
      }
      void get()
        .patchSection('ui', { showGemini: v })
        .catch(() => undefined)
      const nextActive = !v && s.active === 'gemini' ? 'service' : s.active
      return { showGemini: v, active: nextActive }
    }),

  showClaude: (() => {
    try {
      return localStorage.getItem('sharegpt-show-claude') !== '0'
    } catch {
      return true
    }
  })(),
  // 切换是否展示 Claude: 同 Gemini 逻辑; 关闭时若正处于 Claude 页则切回「代理转发」。
  setShowClaude: (v) =>
    set((s) => {
      try {
        localStorage.setItem('sharegpt-show-claude', v ? '1' : '0')
      } catch {
        /* ignore */
      }
      void get()
        .patchSection('ui', { showClaude: v })
        .catch(() => undefined)
      const nextActive = !v && s.active === 'claude' ? 'service' : s.active
      return { showClaude: v, active: nextActive }
    }),

  hiddenNav: (() => {
    try {
      const raw = localStorage.getItem('sharegpt-hidden-nav')
      const arr = raw ? JSON.parse(raw) : []
      return Array.isArray(arr) ? (arr as NavKey[]) : []
    } catch {
      return []
    }
  })(),
  // 隐藏/显示某个内容入口; 隐藏正在查看的入口时自动切回「网络/代理」。
  setNavHidden: (key, hidden) =>
    set((s) => {
      const next = hidden
        ? [...new Set([...s.hiddenNav, key])]
        : s.hiddenNav.filter((k) => k !== key)
      try {
        localStorage.setItem('sharegpt-hidden-nav', JSON.stringify(next))
      } catch {
        /* ignore */
      }
      void get()
        .patchSection('ui', { hiddenNav: next })
        .catch(() => undefined)
      const nextActive = hidden && s.active === key ? 'service' : s.active
      return { hiddenNav: next, active: nextActive }
    }),

  navOrder: (() => {
    try {
      const raw = localStorage.getItem('sharegpt-nav-order')
      const arr = raw ? JSON.parse(raw) : []
      return Array.isArray(arr) ? (arr as NavKey[]) : []
    } catch {
      return []
    }
  })(),
  setNavOrder: (order) =>
    set(() => {
      try {
        localStorage.setItem('sharegpt-nav-order', JSON.stringify(order))
      } catch {
        /* ignore */
      }
      void get()
        .patchSection('ui', { navOrder: order })
        .catch(() => undefined)
      return { navOrder: order }
    }),

  sidebarHidden: (() => {
    try {
      return localStorage.getItem('sharegpt-sidebar-hidden') === '1'
    } catch {
      return false
    }
  })(),
  setSidebarHidden: (v) =>
    set(() => {
      try {
        localStorage.setItem('sharegpt-sidebar-hidden', v ? '1' : '0')
      } catch {
        /* ignore */
      }
      return { sidebarHidden: v }
    }),
  toggleSidebarHidden: () =>
    set((s) => {
      const next = !s.sidebarHidden
      try {
        localStorage.setItem('sharegpt-sidebar-hidden', next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return { sidebarHidden: next }
    }),

  mode: '',
  meta: {},
  settings: null,
  status: {},
  authed: false,
  // 登录成功(authed=true)时一并退出预览态; 退出登录(false)不动预览态。
  setAuthed: (v) => set(v ? { authed: true, previewMode: false } : { authed: false }),

  previewMode: false,
  setPreviewMode: (v) => set({ previewMode: v }),

  tourOpen: false,
  setTourOpen: (v) => set({ tourOpen: v }),

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
    // 启动时同步内嵌网页明暗 = 当前 app 主题。
    void api.setThemeSource(get().dark ? 'dark' : 'light').catch(() => undefined)
    // 侧栏左右位置同样优先取磁盘设置 (跨设备一致), 无则保留 localStorage 现值。
    const savedSide = mergedSettings.ui?.sidebarSide
    if (savedSide === 'left' || savedSide === 'right') {
      set({ sidebarSide: savedSide })
    }
    // 是否展示 Gemini 同样优先取磁盘设置, 无则保留 localStorage 现值。
    const savedShowGemini = mergedSettings.ui?.showGemini
    if (typeof savedShowGemini === 'boolean') {
      set({ showGemini: savedShowGemini })
      if (!savedShowGemini && get().active === 'gemini') set({ active: 'service' })
    }
    const savedHidden = mergedSettings.ui?.hiddenNav
    if (Array.isArray(savedHidden)) set({ hiddenNav: savedHidden as NavKey[] })

    const savedOrder = mergedSettings.ui?.navOrder
    if (Array.isArray(savedOrder)) set({ navOrder: savedOrder as NavKey[] })

    const savedShowClaude = mergedSettings.ui?.showClaude
    if (typeof savedShowClaude === 'boolean') {
      set({ showClaude: savedShowClaude })
      if (!savedShowClaude && get().active === 'claude') set({ active: 'service' })
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
