import { create } from 'zustand'
import { api } from '@/lib/api'
import { settingsPrincipalRuntime } from '@/lib/settingsPrincipalRuntime'
import {
  isCurrentTranslationRequest,
  isTranslationTarget,
  type TranslationRequestToken,
} from '@/lib/translationSession'
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
  principalId: string
  open: boolean
  kind: AiKind
  tabId: string
  sourceText: string
  result: string
  status: string
  loading: boolean
  settingsOpen: boolean
  requestGeneration: number
  loaded: boolean
  config: TranslationSettings
  load: () => Promise<void>
  saveConfig: (patch: Partial<TranslationSettings>) => Promise<void>
  activateTarget: (kind: AiKind, tabId: string) => void
  beginRequest: (
    kind: AiKind,
    tabId: string,
    patch?: Partial<Pick<TranslationState, 'sourceText' | 'result' | 'status'>>,
  ) => TranslationRequestToken | null
  snapshotRequest: (kind: AiKind, tabId: string) => TranslationRequestToken | null
  applyRequest: (
    token: TranslationRequestToken,
    patch: Partial<
      Pick<TranslationState, 'sourceText' | 'result' | 'status' | 'loading' | 'settingsOpen'>
    >,
  ) => void
  appendRequestResult: (token: TranslationRequestToken, text: string) => void
  invalidateRequests: (kind: AiKind, tabId: string) => void
  toggle: (kind: AiKind, tabId: string) => void
  openSelection: (kind: AiKind, tabId: string, text: string) => void
  close: () => void
  setSourceText: (kind: AiKind, tabId: string, text: string) => void
  setSettingsOpen: (kind: AiKind, tabId: string, open: boolean) => void
  resetForPrincipal: (principalId: string, settings?: Partial<TranslationSettings>) => void
}

export const useTranslationStore = create<TranslationState>((set, get) => ({
  principalId: 'local-device',
  open: false,
  kind: 'gpt',
  tabId: '',
  sourceText: '',
  result: '',
  status: '',
  loading: false,
  settingsOpen: false,
  requestGeneration: 0,
  loaded: false,
  config: DEFAULT_TRANSLATION_SETTINGS,

  load: async () => {
    if (get().loaded) return
    const principalSnapshot = settingsPrincipalRuntime.snapshot()
    try {
      const settings = (await api.loadSettings({
        expectedPrincipalId: principalSnapshot.principalId,
      })) as Record<string, unknown>
      settingsPrincipalRuntime.assertCurrent(principalSnapshot)
      if (get().principalId !== principalSnapshot.principalId) return
      set({
        config: normalizeSettings(
          settings.translation as Partial<TranslationSettings> | undefined,
          settings.notesAi as Partial<TranslationSettings['ai']> | undefined,
        ),
        loaded: true,
      })
    } catch {
      if (settingsPrincipalRuntime.current().generation === principalSnapshot.generation) {
        set({ loaded: true })
      }
    }
  },

  saveConfig: async (patch) => {
    const principalSnapshot = settingsPrincipalRuntime.snapshot()
    if (get().principalId !== principalSnapshot.principalId) {
      throw new Error('当前翻译配置账号已失效，请重新登录')
    }
    const previous = get().config
    const config = normalizeSettings({ ...get().config, ...patch })
    settingsPrincipalRuntime.assertCurrent(principalSnapshot)
    set({ config })
    try {
      await useAppStore.getState().patchSection('translation', config)
    } catch (error) {
      settingsPrincipalRuntime.assertCurrent(principalSnapshot)
      set({ config: normalizeSettings(useAppStore.getState().settings?.translation || previous) })
      throw error
    }
    settingsPrincipalRuntime.assertCurrent(principalSnapshot)
    const saved = useAppStore.getState().settings
    set({
      config: normalizeSettings(saved?.translation),
    })
  },

  activateTarget: (kind, tabId) =>
    set((state) => {
      if (isTranslationTarget(state, kind, tabId)) return state
      return {
        kind,
        tabId,
        sourceText: '',
        result: '',
        status: '',
        loading: false,
        settingsOpen: false,
        requestGeneration: state.requestGeneration + 1,
      }
    }),
  beginRequest: (kind, tabId, patch = {}) => {
    const state = get()
    if (!isTranslationTarget(state, kind, tabId)) return null
    const token = { kind, tabId, generation: state.requestGeneration + 1 }
    set({
      ...patch,
      loading: true,
      requestGeneration: token.generation,
    })
    return token
  },
  snapshotRequest: (kind, tabId) => {
    const state = get()
    if (!isTranslationTarget(state, kind, tabId)) return null
    return { kind, tabId, generation: state.requestGeneration }
  },
  applyRequest: (token, patch) =>
    set((state) => (isCurrentTranslationRequest(state, token) ? patch : state)),
  appendRequestResult: (token, text) =>
    set((state) =>
      isCurrentTranslationRequest(state, token) ? { result: state.result + text } : state,
    ),
  invalidateRequests: (kind, tabId) =>
    set((state) =>
      isTranslationTarget(state, kind, tabId)
        ? {
            requestGeneration: state.requestGeneration + 1,
            loading: false,
          }
        : state,
    ),
  toggle: (kind, tabId) =>
    set((state) => {
      if (!tabId) return state
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
        requestGeneration: state.requestGeneration + 1,
      }
    }),
  openSelection: (kind, tabId, text) =>
    set((state) =>
      tabId
        ? {
            open: true,
            kind,
            tabId,
            sourceText: text,
            result: '',
            status: '',
            loading: false,
            settingsOpen: false,
            requestGeneration: state.requestGeneration + 1,
          }
        : state,
    ),
  close: () =>
    set((state) => ({
      open: false,
      loading: false,
      status: '',
      settingsOpen: false,
      requestGeneration: state.requestGeneration + 1,
    })),
  setSourceText: (kind, tabId, sourceText) =>
    set((state) => (isTranslationTarget(state, kind, tabId) ? { sourceText } : state)),
  setSettingsOpen: (kind, tabId, settingsOpen) =>
    set((state) => (isTranslationTarget(state, kind, tabId) ? { settingsOpen } : state)),
  resetForPrincipal: (principalId, settings) =>
    set((state) => ({
      principalId: String(principalId || ''),
      open: false,
      tabId: '',
      sourceText: '',
      result: '',
      status: '',
      loading: false,
      settingsOpen: false,
      requestGeneration: state.requestGeneration + 1,
      loaded: true,
      config: normalizeSettings(settings),
    })),
}))
