import { create } from 'zustand'
import { api } from '@/lib/api'
import { settingsPrincipalRuntime } from '@/lib/settingsPrincipalRuntime'
import { useAppStore } from '@/store/useAppStore'
import type { AiKind } from '@/store/useAiStore'
import type { TranslationProvider, TranslationSettings, TranslationStyle } from '@/types/settings'

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
  siteLanguage: 'en',
  style: 'natural',
  glossary: '',
  confirmNonTargetSend: false,
  autoTranslateSelection: false,
  ai: DEFAULT_AI,
  api: { baseUrl: '', apiKey: '' },
  offline: { baseUrl: 'http://127.0.0.1:5000' },
}

function normalizeSettings(
  raw: Partial<TranslationSettings> | undefined,
  notesAi?: Partial<TranslationSettings['ai']>,
): TranslationSettings {
  const style = ['natural', 'literal', 'concise'].includes(String(raw?.style))
    ? (raw?.style as TranslationStyle)
    : 'natural'
  return {
    ...DEFAULT_TRANSLATION_SETTINGS,
    ...raw,
    version: 1,
    style,
    glossary: String(raw?.glossary || '').slice(0, 4000),
    confirmNonTargetSend: raw?.confirmNonTargetSend === true,
    autoTranslateSelection: raw?.autoTranslateSelection === true,
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
  environmentId: string
  sourceKind: 'manual' | 'selection' | 'page'
  sourceText: string
  result: string
  phase: 'idle' | 'translating' | 'ready' | 'stale' | 'writing' | 'error'
  resultEdited: boolean
  autoTranslateRequest: number
  status: string
  loading: boolean
  settingsOpen: boolean
  loaded: boolean
  config: TranslationSettings
  pendingComposerConfirmation: {
    kind: AiKind
    tabId: string
    environmentId: string
    requestId: string
    targetLanguage: string
    expiresAt: number
  } | null
  load: () => Promise<void>
  saveConfig: (patch: Partial<TranslationSettings>) => Promise<void>
  setProvider: (provider: TranslationProvider) => Promise<void>
  toggle: (kind: AiKind, tabId: string, environmentId: string) => void
  openSelection: (kind: AiKind, tabId: string, environmentId: string, text: string) => void
  close: () => void
  setSourceText: (text: string) => void
  setCapturedSource: (
    sourceKind: 'selection' | 'page',
    text: string,
    options?: { autoTranslate?: boolean; status?: string },
  ) => void
  setResult: (text: string) => void
  appendResult: (text: string) => void
  editResult: (text: string) => void
  beginTranslation: () => void
  completeTranslation: () => void
  markStale: (status?: string) => void
  setStatus: (status: string) => void
  setLoading: (loading: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setPendingComposerConfirmation: (pending: TranslationState['pendingComposerConfirmation']) => void
  resetForPrincipal: (principalId: string, settings?: Partial<TranslationSettings>) => void
}

export const useTranslationStore = create<TranslationState>((set, get) => ({
  principalId: 'local-device',
  open: false,
  kind: 'gpt',
  tabId: '',
  environmentId: '',
  sourceKind: 'manual',
  sourceText: '',
  result: '',
  phase: 'idle',
  resultEdited: false,
  autoTranslateRequest: 0,
  status: '',
  loading: false,
  settingsOpen: false,
  loaded: false,
  config: DEFAULT_TRANSLATION_SETTINGS,
  pendingComposerConfirmation: null,

  load: async () => {
    if (get().loaded) return
    const principal = settingsPrincipalRuntime.snapshot()
    try {
      const settings = (await api.loadSettings({
        expectedPrincipalId: principal.principalId,
        expectedPrincipalGeneration: principal.generation,
      })) as Record<string, unknown>
      settingsPrincipalRuntime.assertCurrent(principal)
      if (get().principalId !== principal.principalId) return
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
    const principal = settingsPrincipalRuntime.snapshot()
    if (get().principalId !== principal.principalId) {
      throw new Error('当前翻译配置账号已失效，请重新登录')
    }
    const previous = get().config
    const config = normalizeSettings({
      ...previous,
      ...patch,
      ai: { ...previous.ai, ...patch.ai },
      api: { ...previous.api, ...patch.api },
      offline: { ...previous.offline, ...patch.offline },
    })
    set({ config })
    try {
      await useAppStore.getState().patchSection('translation', config)
      settingsPrincipalRuntime.assertCurrent(principal)
      set({ config: normalizeSettings(useAppStore.getState().settings?.translation) })
      await api.syncAiComposerGuard().catch(() => undefined)
      settingsPrincipalRuntime.assertCurrent(principal)
    } catch (error) {
      settingsPrincipalRuntime.assertCurrent(principal)
      set({ config: normalizeSettings(useAppStore.getState().settings?.translation || previous) })
      throw error
    }
  },

  setProvider: async (provider) => get().saveConfig({ provider }),
  toggle: (kind, tabId, environmentId) =>
    set((state) => {
      const sameWorkspace =
        state.kind === kind && state.tabId === tabId && state.environmentId === environmentId
      if (sameWorkspace) {
        return { open: !state.open, status: '', settingsOpen: false }
      }
      return {
        open: true,
        kind,
        tabId,
        environmentId,
        sourceKind: 'manual',
        sourceText: '',
        result: '',
        phase: 'idle',
        resultEdited: false,
        status: '',
        settingsOpen: false,
      }
    }),
  openSelection: (kind, tabId, environmentId, text) =>
    set((state) => ({
      open: true,
      kind,
      tabId,
      environmentId,
      sourceKind: 'selection',
      sourceText: text,
      result: '',
      phase: 'idle',
      resultEdited: false,
      autoTranslateRequest: state.autoTranslateRequest + 1,
      status: '已读取网页选中文字',
      settingsOpen: false,
    })),
  close: () => set({ open: false, loading: false, status: '', settingsOpen: false }),
  setSourceText: (sourceText) =>
    set((state) => ({
      sourceText,
      phase: state.result ? 'stale' : 'idle',
      status: state.result ? '原文已变化，请重新翻译' : '',
    })),
  setCapturedSource: (sourceKind, sourceText, options) =>
    set((state) => ({
      sourceKind,
      sourceText,
      result: '',
      phase: 'idle',
      resultEdited: false,
      autoTranslateRequest: options?.autoTranslate
        ? state.autoTranslateRequest + 1
        : state.autoTranslateRequest,
      status: options?.status || '',
    })),
  setResult: (result) => set({ result, resultEdited: false }),
  appendResult: (text) => set((state) => ({ result: state.result + text })),
  editResult: (result) =>
    set((state) => ({
      result,
      resultEdited: true,
      phase: state.phase === 'stale' ? 'stale' : result.trim() ? 'ready' : 'idle',
      status: state.phase === 'stale' ? state.status : '译文已修改',
    })),
  beginTranslation: () =>
    set({
      result: '',
      resultEdited: false,
      phase: 'translating',
      loading: true,
      status: '正在翻译…',
    }),
  completeTranslation: () =>
    set({ phase: 'ready', loading: false, status: '译文已就绪，可以修改或填入' }),
  markStale: (status = '翻译设置已变化，请重新翻译') =>
    set((state) => ({ phase: state.result ? 'stale' : state.phase, status })),
  setStatus: (status) => set({ status }),
  setLoading: (loading) => set({ loading }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setPendingComposerConfirmation: (pendingComposerConfirmation) =>
    set({ pendingComposerConfirmation }),
  resetForPrincipal: (principalId, settings) =>
    set({
      principalId: String(principalId || ''),
      open: false,
      tabId: '',
      environmentId: '',
      sourceKind: 'manual',
      sourceText: '',
      result: '',
      phase: 'idle',
      resultEdited: false,
      autoTranslateRequest: 0,
      status: '',
      loading: false,
      settingsOpen: false,
      pendingComposerConfirmation: null,
      loaded: true,
      config: normalizeSettings(settings),
    }),
}))
