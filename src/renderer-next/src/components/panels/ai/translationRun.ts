import { api } from '@/lib/api'
import {
  cancelManagedTranslation,
  createManagedTranslationRequestId,
  managedTranslate,
} from '@/lib/managedTranslation'
import { runAi } from '@/lib/notes/aiClient'
import type { TranslationSettings } from '@/types/settings'
import { TARGET_LABELS } from './translationLanguages'

export interface TranslationRun {
  promise: Promise<string>
  cancel: () => void
}

export function startTranslation(
  config: TranslationSettings,
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  callbacks: { onDelta?: (text: string) => void; onStatus?: (status: string) => void } = {},
  managedContext?: { serverUrl: string; token: string },
): TranslationRun {
  if (config.provider === 'managed') {
    const controller = new AbortController()
    const requestId = createManagedTranslationRequestId()
    const promise = managedTranslate(
      managedContext?.serverUrl || '',
      managedContext?.token || '',
      {
        profileId: config.managed.profileId || undefined,
        text,
        source: sourceLanguage,
        target: targetLanguage,
        style: config.style,
        glossary: config.glossary,
        requestId,
      },
      { signal: controller.signal },
    ).then((response) => response.translatedText)
    return {
      promise,
      cancel: () => {
        controller.abort()
        void cancelManagedTranslation(
          managedContext?.serverUrl || '',
          managedContext?.token || '',
          requestId,
        ).catch(() => undefined)
      },
    }
  }

  if (config.provider !== 'ai') {
    const requestId = createManagedTranslationRequestId()
    const provider = config.provider
    const providerConfig = provider === 'offline' ? config.offline : config.api
    const promise = api
      .translateText({
        requestId,
        mode: provider,
        baseUrl: providerConfig.baseUrl,
        apiKey: provider === 'api' ? config.api.apiKey : undefined,
        text,
        source: sourceLanguage,
        target: targetLanguage,
      })
      .then((response) => response.translatedText.trim())
    return {
      promise,
      cancel: () => {
        void api.cancelTranslation(requestId).catch(() => undefined)
      },
    }
  }

  if (!config.ai.baseUrl || !config.ai.apiKey) {
    return {
      promise: Promise.reject(new Error('请先配置 AI 接口地址和密钥')),
      cancel: () => undefined,
    }
  }

  let cancel: () => void = () => undefined
  const promise = new Promise<string>((resolve, reject) => {
    let settled = false
    let accumulated = ''
    const finish = (callback: (value: string) => void, value: string) => {
      if (settled) return
      settled = true
      callback(value)
    }
    const stop = runAi(
      {
        provider: config.ai,
        mode: 'translate',
        text,
        ctx: {
          targetLanguage: TARGET_LABELS[targetLanguage] || targetLanguage,
          translationStyle: config.style,
          glossary: config.glossary,
        },
      },
      {
        onDelta: (delta) => {
          accumulated += delta
          callbacks.onDelta?.(delta)
        },
        onStatus: (status) => callbacks.onStatus?.(status),
        onDone: () => finish(resolve, accumulated.trim()),
        onError: (message) => finish((value) => reject(new Error(value)), message),
        onCancelled: () =>
          finish(
            (value) => reject(Object.assign(new Error(value), { name: 'AbortError' })),
            '账号已切换',
          ),
      },
    )
    cancel = () => {
      stop()
      finish(
        (value) => reject(Object.assign(new Error(value), { name: 'AbortError' })),
        '操作已取消',
      )
    }
  })
  return { promise, cancel: () => cancel() }
}
