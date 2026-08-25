import { create } from 'zustand'
import { api } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import type { AiKind } from '@/store/useAiStore'
import type { TranslationProvider, TranslationSettings } from '@/types/settings'

const DEFAULT_AI = {
  baseUrl: '',
  apiKey: '',
  model: 'gpt-5.5',
  effort: 'medium',
}

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  version: 1,
  provider: 'ai',
  sourceLanguage: 'auto',
  targetLanguage: 'zh',
  ai: DEFAULT_AI,
  api: { baseUrl: '', apiKey: '' },
  offline: { baseUrl: 'http://127.0.0.1:5000' },
}

function normalizeSettings(
  raw: Partial<TranslationSettings> | undefined,
  notesAi?: Partial<TranslationSettings['ai']>,
): TranslationSettings {
  return {
    ...DEFAULT_TRANSLATION_SETTINGS,
    ...raw,
    version: 1,
    provider: ['ai', 'api', 'offline'].includes(String(raw?.provider))
      ? (raw?.provider as TranslationProvider)
      : 'ai',
    ai: { ...DEFAULT_AI, ...notesAi, ...raw?.ai },
    api: { ...DEFAULT_TRANSLATION_SETTINGS.api, ...raw?.api },
    offline: { ...DEFAULT_TRANSLATION_SETTINGS.offline, ...raw?.offline },
  }
}

interface TranslationState {
  open: boolean
  kind: AiKind
  tabId: string
  sourceText: string
  result: string
  status: string
  loading: boolean
  settingsOpen: boolean
  loaded: boolean
  config: TranslationSettings
  load: () => Promise<void>
  saveConfig: (patch: Partial<TranslationSettings>) => Promise<void>
  setProvider: (provider: TranslationProvider) => Promise<void>
  toggle: (kind: AiKind, tabId: string) => void
  openSelection: (kind: AiKind, tabId: string, text: string) => void
  close: () => void
  setSourceText: (text: string) => void
  setResult: (text: string) => void
  appendResult: (text: string) => void
  setStatus: (status: string) => void
  setLoading: (loading: boolean) => void
  setSettingsOpen: (open: boolean) => void
}

export const useTranslationStore = create<TranslationState>((set, get) => ({
  open: false,
  kind: 'gpt',
  tabId: '',
  sourceText: '',
  result: '',
  status: '',
  loading: false,
  settingsOpen: false,
  loaded: false,
  config: DEFAULT_TRANSLATION_SETTINGS,

  load: async () => {
    if (get().loaded) return
    try {
      const settings = (await api.loadSettings()) as Record<string, unknown>
      set({
        config: normalizeSettings(
          settings.translation as Partial<TranslationSettings> | undefined,
          settings.notesAi as Partial<TranslationSettings['ai']> | undefined,
        ),
        loaded: true,
      })
    } catch {
      set({ loaded: true })
    }
  },

  saveConfig: async (patch) => {
    const previous = get().config
    const config = normalizeSettings({ ...get().config, ...patch })
    set({ config })
    try {
      await useAppStore.getState().patchSection('translation', config)
    } catch (error) {
      set({ config: normalizeSettings(useAppStore.getState().settings?.translation || previous) })
      throw error
    }
    const saved = useAppStore.getState().settings
    set({
      config: normalizeSettings(saved?.translation),
    })
  },

  setProvider: async (provider) => get().saveConfig({ provider }),
  toggle: (kind, tabId) =>
    set((state) => {
      const sameTarget = state.kind === kind && state.tabId === tabId
      return {
        open: sameTarget ? !state.open : true,
        kind,
        tabId,
        sourceText: sameTarget ? state.sourceText : '',
        result: sameTarget ? state.result : '',
        loading: false,
        status: '',
        settingsOpen: false,
      }
    }),
  openSelection: (kind, tabId, text) =>
    set({
      open: true,
      kind,
      tabId,
      sourceText: text,
      result: '',
      status: '',
      settingsOpen: false,
    }),
  close: () => set({ open: false, loading: false, status: '', settingsOpen: false }),
  setSourceText: (sourceText) => set({ sourceText }),
  setResult: (result) => set({ result }),
  appendResult: (text) => set((state) => ({ result: state.result + text })),
  setStatus: (status) => set({ status }),
  setLoading: (loading) => set({ loading }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
}))
