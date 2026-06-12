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
  toggleTheme: () =>
    set((s) => {
      const next = !s.dark
      applyTheme(next)
      return { dark: next }
    }),

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
    set({
      settings: { ...EMPTY_SETTINGS, ...(settings as AppSettings) },
      mode: String(mode || ''),
      meta: meta as Record<string, unknown>,
      status: status as StatusPayload,
    })
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
