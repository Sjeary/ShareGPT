import { create } from 'zustand'
import { api } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import type { NotesAiProvider } from '@/types/api'

// 知识库与翻译共用 settings.translation.ai，避免维护两份会漂移的 provider 配置。
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

const DEFAULTS = { baseUrl: '', model: 'gpt-5.5', effort: 'medium' }

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
      const translation = (settings?.translation ?? {}) as {
        ai?: Partial<NotesAiProvider>
      }
      const c = translation.ai ?? {}
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
    const previous = get()
    set(patch)
    const s = get()
    try {
      const translation = useAppStore.getState().settings?.translation
      await useAppStore.getState().patchSection('translation', {
        ...translation,
        ai: { baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model, effort: s.effort },
      })
    } catch (error) {
      set({
        baseUrl: previous.baseUrl,
        apiKey: previous.apiKey,
        model: previous.model,
        effort: previous.effort,
      })
      throw error
    }
  },

  provider: () => {
    const s = get()
    return { baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model, effort: s.effort }
  },
  configured: () => Boolean(get().apiKey && get().baseUrl),
}))
