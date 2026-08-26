import { create } from 'zustand'
import { api } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import { useTranslationStore } from '@/store/useTranslationStore'
import type { NotesAiProvider } from '@/types/api'
import type { AppSettings, TranslationSettings } from '@/types/settings'
import {
  DEFAULT_NOTES_AI_PROVIDER,
  notesAiProviderFromSettings,
} from '@/lib/notes/notesAiLifecycle'

// 知识库与翻译共用 settings.translation.ai，避免维护两份会漂移的 provider 配置。
interface NotesAiState {
  principalId: string
  principalGeneration: number
  save: (patch: Partial<NotesAiProvider>) => Promise<void>
  provider: () => NotesAiProvider
  configured: () => boolean
  resetForPrincipal: (principalId: string, settings?: Partial<TranslationSettings>) => void
  invalidatePrincipal: () => void
}

const DEFAULTS: NotesAiProvider = DEFAULT_NOTES_AI_PROVIDER

function currentProvider(): NotesAiProvider {
  return notesAiProviderFromSettings(useAppStore.getState().settings?.translation)
}

function setRendererProvider(provider: NotesAiProvider): void {
  const appSettings = useAppStore.getState().settings
  if (appSettings) {
    const translation = appSettings.translation || useTranslationStore.getState().config
    useAppStore.setState({
      settings: {
        ...appSettings,
        translation: {
          ...translation,
          ai: provider,
        },
      },
    })
  }
  useTranslationStore.setState((state) => ({
    config: { ...state.config, ai: provider },
  }))
}

export const useNotesAiStore = create<NotesAiState>((set, get) => ({
  principalId: 'local-device',
  principalGeneration: 0,

  save: async (patch) => {
    const session = get()
    if (!session.principalId) throw new Error('当前账号登录状态已失效，请重新登录')
    const principalId = session.principalId
    const principalGeneration = session.principalGeneration
    const previous = currentProvider()
    const provider = {
      baseUrl: patch.baseUrl ?? previous.baseUrl,
      apiKey: patch.apiKey ?? previous.apiKey,
      model: patch.model ?? previous.model,
      effort: patch.effort ?? previous.effort,
    }
    const appSettings = useAppStore.getState().settings
    const saved = (await api.operateSettings({
      section: 'translation',
      operations: [
        { op: 'set', path: ['ai', 'baseUrl'], value: provider.baseUrl },
        { op: 'set', path: ['ai', 'apiKey'], value: provider.apiKey },
        { op: 'set', path: ['ai', 'model'], value: provider.model },
        { op: 'set', path: ['ai', 'effort'], value: provider.effort },
      ],
      expectedRevision: appSettings?.settingsRevision,
      expectedPrincipalId: principalId,
    })) as unknown as AppSettings
    const current = get()
    if (
      current.principalId !== principalId ||
      current.principalGeneration !== principalGeneration
    ) {
      throw new Error('账号已切换，Notes AI 配置未应用到当前账号')
    }
    const currentSettings = useAppStore.getState().settings
    if ((currentSettings?.settingsRevision ?? -1) > saved.settingsRevision) return
    useAppStore.setState({ settings: saved })
    setRendererProvider(notesAiProviderFromSettings(saved.translation))
  },

  provider: () => {
    return currentProvider()
  },
  configured: () => {
    const provider = currentProvider()
    return Boolean(provider.apiKey && provider.baseUrl)
  },
  resetForPrincipal: (principalId, settings) => {
    setRendererProvider(notesAiProviderFromSettings(settings))
    set((state) => ({
      principalId: String(principalId || ''),
      principalGeneration: state.principalGeneration + 1,
    }))
  },
  invalidatePrincipal: () => {
    setRendererProvider(DEFAULTS)
    useTranslationStore.getState().resetForPrincipal()
    set((state) => ({
      principalId: '',
      principalGeneration: state.principalGeneration + 1,
    }))
  },
}))
