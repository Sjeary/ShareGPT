import type { AiKind } from '../store/useAiStore.ts'

export interface TranslationRequestToken {
  kind: AiKind
  tabId: string
  generation: number
}

export function isTranslationTarget(
  current: { kind: AiKind; tabId: string },
  kind: AiKind,
  tabId: string,
) {
  return Boolean(tabId) && current.kind === kind && current.tabId === tabId
}

export function isCurrentTranslationRequest(
  current: { kind: AiKind; tabId: string; requestGeneration: number },
  token: TranslationRequestToken,
) {
  return (
    isTranslationTarget(current, token.kind, token.tabId) &&
    current.requestGeneration === token.generation
  )
}

export function hasPendingAutoTranslation(
  current: {
    kind: AiKind
    tabId: string
    autoTranslateGeneration: number
    autoTranslateConsumedGeneration: number
  },
  kind: AiKind,
  tabId: string,
) {
  return (
    isTranslationTarget(current, kind, tabId) &&
    current.autoTranslateGeneration > current.autoTranslateConsumedGeneration
  )
}
