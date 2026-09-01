import { create } from 'zustand'
import { api } from '@/lib/api'
import { settingsPrincipalRuntime } from '@/lib/settingsPrincipalRuntime'
import { buildComposerPreview, type ComposerOutputFormat } from '@/lib/translationWorkflow'
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
  managed: { profileId: '' },
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
    provider: ['managed', 'ai', 'api', 'offline'].includes(String(raw?.provider))
      ? (raw?.provider as TranslationProvider)
      : 'ai',
    ai: { ...DEFAULT_AI, ...notesAi, ...raw?.ai },
    managed: { ...DEFAULT_TRANSLATION_SETTINGS.managed, ...raw?.managed },
    api: { ...DEFAULT_TRANSLATION_SETTINGS.api, ...raw?.api },
    offline: { ...DEFAULT_TRANSLATION_SETTINGS.offline, ...raw?.offline },
  }
}

type TranslationPhase = 'idle' | 'translating' | 'ready' | 'stale' | 'writing' | 'error'

interface ReaderTranslationState {
  sourceKind: 'manual' | 'selection' | 'page'
  sourceText: string
  result: string
  phase: TranslationPhase
  autoTranslateRequest: number
  status: string
  loading: boolean
}

interface ComposerTranslationState {
  sourceText: string
  translation: string
  preview: string
  outputFormat: ComposerOutputFormat
  phase: TranslationPhase
  previewEdited: boolean
  status: string
  loading: boolean
}

const emptyReader = (): ReaderTranslationState => ({
  sourceKind: 'manual',
  sourceText: '',
  result: '',
  phase: 'idle',
  autoTranslateRequest: 0,
  status: '',
  loading: false,
})

const emptyComposer = (): ComposerTranslationState => ({
  sourceText: '',
  translation: '',
  preview: '',
  outputFormat: 'translated',
  phase: 'idle',
  previewEdited: false,
  status: '',
  loading: false,
})

interface TranslationState {
  principalId: string
  open: boolean
  kind: AiKind
  tabId: string
  environmentId: string
  mode: 'read' | 'compose'
  reader: ReaderTranslationState
  composer: ComposerTranslationState
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
  setMode: (mode: 'read' | 'compose') => void
  setReaderSourceText: (text: string) => void
  setReaderCapturedSource: (
    sourceKind: 'selection' | 'page',
    text: string,
    options?: { autoTranslate?: boolean; status?: string },
  ) => void
  setReaderResult: (text: string) => void
  appendReaderResult: (text: string) => void
  beginReaderTranslation: () => void
  completeReaderTranslation: () => void
  setReaderStatus: (status: string) => void
  setReaderLoading: (loading: boolean) => void
  setComposerSourceText: (text: string) => void
  appendComposerTranslation: (text: string) => void
  editComposerPreview: (text: string) => void
  beginComposerTranslation: () => void
  completeComposerTranslation: (translatedText: string) => void
  setComposerOutputFormat: (format: ComposerOutputFormat) => void
  setComposerStatus: (status: string) => void
  beginComposerWrite: () => void
  completeComposerWrite: (status: string) => void
  markStale: (status?: string) => void
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
  mode: 'read',
  reader: emptyReader(),
  composer: emptyComposer(),
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
      managed: { ...previous.managed, ...patch.managed },
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
        return { open: !state.open, settingsOpen: false }
      }
      return {
        open: true,
        kind,
        tabId,
        environmentId,
        mode: 'read',
        reader: emptyReader(),
        composer: emptyComposer(),
        settingsOpen: false,
      }
    }),
  openSelection: (kind, tabId, environmentId, text) =>
    set((state) => {
      const sameWorkspace =
        state.kind === kind && state.tabId === tabId && state.environmentId === environmentId
      return {
        open: true,
        kind,
        tabId,
        environmentId,
        mode: 'read',
        reader: {
          ...emptyReader(),
          sourceKind: 'selection',
          sourceText: text,
          autoTranslateRequest: state.reader.autoTranslateRequest + 1,
          status: '已读取网页选中文字',
        },
        composer: sameWorkspace ? state.composer : emptyComposer(),
        settingsOpen: false,
      }
    }),
  close: () =>
    set((state) => ({
      open: false,
      reader: { ...state.reader, loading: false, status: '' },
      composer: { ...state.composer, loading: false, status: '' },
      settingsOpen: false,
    })),
  setMode: (mode) =>
    set((state) => ({
      mode,
      reader:
        state.reader.phase === 'translating'
          ? { ...state.reader, phase: state.reader.result ? 'ready' : 'idle', loading: false }
          : state.reader,
      composer:
        state.composer.phase === 'translating' || state.composer.phase === 'writing'
          ? {
              ...state.composer,
              phase: state.composer.preview ? 'ready' : 'idle',
              loading: false,
            }
          : state.composer,
    })),
  setReaderSourceText: (sourceText) =>
    set((state) => ({
      reader: {
        ...state.reader,
        sourceKind: 'manual',
        sourceText,
        phase: state.reader.result ? 'stale' : 'idle',
        status: state.reader.result ? '原文已变化，请重新翻译' : '',
      },
    })),
  setReaderCapturedSource: (sourceKind, sourceText, options) =>
    set((state) => ({
      reader: {
        ...state.reader,
        sourceKind,
        sourceText,
        result: '',
        phase: 'idle',
        autoTranslateRequest: options?.autoTranslate
          ? state.reader.autoTranslateRequest + 1
          : state.reader.autoTranslateRequest,
        status: options?.status || '',
      },
    })),
  setReaderResult: (result) => set((state) => ({ reader: { ...state.reader, result } })),
  appendReaderResult: (text) =>
    set((state) => ({ reader: { ...state.reader, result: state.reader.result + text } })),
  beginReaderTranslation: () =>
    set((state) => ({
      reader: {
        ...state.reader,
        result: '',
        phase: 'translating',
        loading: true,
        status: '正在翻译…',
      },
    })),
  completeReaderTranslation: () =>
    set((state) => ({
      reader: { ...state.reader, phase: 'ready', loading: false, status: '译文已就绪' },
    })),
  setReaderStatus: (status) => set((state) => ({ reader: { ...state.reader, status } })),
  setReaderLoading: (loading) => set((state) => ({ reader: { ...state.reader, loading } })),
  setComposerSourceText: (sourceText) =>
    set((state) => ({
      composer: {
        ...state.composer,
        sourceText,
        phase: state.composer.preview ? 'stale' : 'idle',
        status: state.composer.preview ? '原文已变化，请重新生成发送预览' : '',
      },
    })),
  appendComposerTranslation: (text) =>
    set((state) => ({
      composer: {
        ...state.composer,
        translation: state.composer.translation + text,
      },
    })),
  editComposerPreview: (preview) =>
    set((state) => ({
      composer: {
        ...state.composer,
        preview,
        previewEdited: true,
        phase: state.composer.phase === 'stale' ? 'stale' : preview.trim() ? 'ready' : 'idle',
        status: state.composer.phase === 'stale' ? state.composer.status : '发送预览已修改',
      },
    })),
  beginComposerTranslation: () =>
    set((state) => ({
      composer: {
        ...state.composer,
        translation: '',
        preview: '',
        previewEdited: false,
        phase: 'translating',
        loading: true,
        status: '正在生成发送预览…',
      },
    })),
  completeComposerTranslation: (translatedText) =>
    set((state) => ({
      composer: {
        ...state.composer,
        translation: translatedText,
        preview: buildComposerPreview(
          state.composer.sourceText,
          translatedText,
          state.composer.outputFormat,
        ),
        previewEdited: false,
        phase: 'ready',
        loading: false,
        status: '发送预览已就绪，尚未写入网页',
      },
    })),
  setComposerOutputFormat: (outputFormat) =>
    set((state) => ({
      composer: {
        ...state.composer,
        outputFormat,
        preview: buildComposerPreview(
          state.composer.sourceText,
          state.composer.translation,
          outputFormat,
        ),
        previewEdited: false,
        phase: state.composer.translation ? 'ready' : state.composer.phase,
        status: state.composer.translation ? '发送格式已更新，尚未写入网页' : state.composer.status,
      },
    })),
  setComposerStatus: (status) => set((state) => ({ composer: { ...state.composer, status } })),
  beginComposerWrite: () =>
    set((state) => ({
      composer: {
        ...state.composer,
        phase: 'writing',
        status: '正在校验当前网页输入框…',
      },
    })),
  completeComposerWrite: (status) =>
    set((state) => ({
      composer: { ...state.composer, phase: 'ready', loading: false, status },
    })),
  markStale: (status = '翻译设置已变化，请重新翻译') =>
    set((state) => ({
      reader: {
        ...state.reader,
        phase: state.reader.result ? 'stale' : state.reader.phase,
        status: state.reader.result ? status : state.reader.status,
      },
      composer: {
        ...state.composer,
        phase: state.composer.preview ? 'stale' : state.composer.phase,
        status: state.composer.preview ? status : state.composer.status,
      },
    })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setPendingComposerConfirmation: (pendingComposerConfirmation) =>
    set({ pendingComposerConfirmation }),
  resetForPrincipal: (principalId, settings) =>
    set({
      principalId: String(principalId || ''),
      open: false,
      tabId: '',
      environmentId: '',
      mode: 'read',
      reader: emptyReader(),
      composer: emptyComposer(),
      settingsOpen: false,
      pendingComposerConfirmation: null,
      loaded: true,
      config: normalizeSettings(settings),
    }),
}))
