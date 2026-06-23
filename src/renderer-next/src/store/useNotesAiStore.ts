import { create } from 'zustand'
import { api } from '@/lib/api'
import type { NotesAiProvider } from '@/types/api'

// 知识库 AI provider 配置 (持久化到 app settings.notesAi; 密钥仅存本机)。
interface NotesAiState {
  baseUrl: string
  apiKey: string
  model: string
  effort: string
  loaded: boolean
  load: () => Promise<void>
  save: (patch: Partial<NotesAiProvider>) => Promise<void>
  provider: () => NotesAiProvider
  configured: () => boolean
}

const DEFAULTS = { baseUrl: 'http://47.113.226.118:8080', model: 'gpt-5.5', effort: 'medium' }

export const useNotesAiStore = create<NotesAiState>((set, get) => ({
  baseUrl: DEFAULTS.baseUrl,
  apiKey: '',
  model: DEFAULTS.model,
  effort: DEFAULTS.effort,
  loaded: false,

  load: async () => {
    if (get().loaded) return
    try {
      const settings = (await api.loadSettings()) as Record<string, unknown>
      const c = (settings?.notesAi ?? {}) as Partial<NotesAiProvider>
      set({
        baseUrl: c.baseUrl || DEFAULTS.baseUrl,
        apiKey: c.apiKey || '',
        model: c.model || DEFAULTS.model,
        effort: c.effort || DEFAULTS.effort,
        loaded: true,
      })
    } catch {
      set({ loaded: true })
    }
  },

  save: async (patch) => {
    set(patch)
    const s = get()
    try {
      const settings = (await api.loadSettings()) as Record<string, unknown>
      await api.saveSettings({
        ...settings,
        notesAi: { baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model, effort: s.effort },
      })
    } catch {
      /* ignore */
    }
  },

  provider: () => {
    const s = get()
    return { baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model, effort: s.effort }
  },
  configured: () => Boolean(get().apiKey && get().baseUrl),
}))
