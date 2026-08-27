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

export interface SelectionTranslationSession {
  kind: AiKind
  tabId: string
  principalId: string
  environmentId: string
  environmentGeneration: number
  navigationGeneration: number
}

export function isCurrentSelectionTranslationSession(
  event: SelectionTranslationSession,
  current: SelectionTranslationSession,
) {
  return (
    event.kind === current.kind &&
    event.tabId === current.tabId &&
    event.principalId === current.principalId &&
    event.environmentId === current.environmentId &&
    event.environmentGeneration === current.environmentGeneration &&
    event.navigationGeneration === current.navigationGeneration
  )
}

export function isComposerGuardEligible(
  profile: { username?: string } | null,
  token: string | null | undefined,
) {
  return Boolean(String(profile?.username || '').trim() && String(token || '').trim())
}

export function shouldClearPendingComposerSend(
  pending: { requestId: string } | null,
  requestId: string,
) {
  return Boolean(pending && requestId && pending.requestId === requestId)
}

export interface OutgoingTranslationSession {
  kind: AiKind
  tabId: string
  requestGeneration: number
  environmentId: string
  environmentGeneration: number
  principalId: string
  principalGeneration: number
  navigationGeneration: number
}

export function isCurrentOutgoingTranslationSession(
  token: OutgoingTranslationSession,
  current: OutgoingTranslationSession,
) {
  return (
    token.kind === current.kind &&
    token.tabId === current.tabId &&
    token.requestGeneration === current.requestGeneration &&
    token.environmentId === current.environmentId &&
    token.environmentGeneration === current.environmentGeneration &&
    token.principalId === current.principalId &&
    token.principalGeneration === current.principalGeneration &&
    token.navigationGeneration === current.navigationGeneration
  )
}

export function composerGuardFailureMessage(message: unknown) {
  const value = String(message || '').trim()
  return value || '无法检查待发送内容，未执行发送'
}
