import assert from 'node:assert/strict'
import test from 'node:test'

import {
  composerGuardFailureMessage,
  hasPendingAutoTranslation,
  isComposerGuardEligible,
  isCurrentOutgoingTranslationSession,
  isCurrentTranslationRequest,
  isTranslationTarget,
  shouldClearPendingComposerSend,
} from './translationSession.ts'

test('translation target requires the same kind and a non-empty active tab', () => {
  const current = { kind: 'gpt' as const, tabId: 'tab-a' }

  assert.equal(isTranslationTarget(current, 'gpt', 'tab-a'), true)
  assert.equal(isTranslationTarget(current, 'gpt', ''), false)
  assert.equal(isTranslationTarget(current, 'gpt', 'tab-b'), false)
  assert.equal(isTranslationTarget(current, 'claude', 'tab-a'), false)
})

test('stale translation requests cannot update a new generation or tab', () => {
  const token = { kind: 'gpt' as const, tabId: 'tab-a', generation: 4 }

  assert.equal(
    isCurrentTranslationRequest({ kind: 'gpt', tabId: 'tab-a', requestGeneration: 4 }, token),
    true,
  )
  assert.equal(
    isCurrentTranslationRequest({ kind: 'gpt', tabId: 'tab-a', requestGeneration: 5 }, token),
    false,
  )
  assert.equal(
    isCurrentTranslationRequest({ kind: 'gpt', tabId: 'tab-b', requestGeneration: 4 }, token),
    false,
  )
})

test('selection auto-translation is consumed once per store generation', () => {
  const pending = {
    kind: 'gpt' as const,
    tabId: 'tab-a',
    autoTranslateGeneration: 3,
    autoTranslateConsumedGeneration: 2,
  }

  assert.equal(hasPendingAutoTranslation(pending, 'gpt', 'tab-a'), true)
  assert.equal(
    hasPendingAutoTranslation({ ...pending, autoTranslateConsumedGeneration: 3 }, 'gpt', 'tab-a'),
    false,
  )
  assert.equal(hasPendingAutoTranslation(pending, 'gpt', 'tab-b'), false)
})

test('composer confirmation eligibility is limited to advanced users and admins', () => {
  assert.equal(isComposerGuardEligible(null), false)
  assert.equal(isComposerGuardEligible({}), false)
  assert.equal(isComposerGuardEligible({ advancedAiAllowed: true }), false)
  assert.equal(isComposerGuardEligible({ isAdmin: true }), false)
  assert.equal(
    isComposerGuardEligible({ advancedAiAllowed: true, routeAuthorizationVerified: true }),
    true,
  )
  assert.equal(isComposerGuardEligible({ isAdmin: true, routeAuthorizationVerified: true }), true)
  assert.equal(
    isComposerGuardEligible({ advancedAiAllowed: true, routeAuthorizationVerified: false }),
    false,
    'an authoritative route revocation disables the main-process guard',
  )
})

test('composer invalidation clears only the matching renderer pending request', () => {
  const pending = { requestId: 'request-current' }
  assert.equal(shouldClearPendingComposerSend(pending, 'request-current'), true)
  assert.equal(shouldClearPendingComposerSend(pending, 'request-old'), false)
  assert.equal(shouldClearPendingComposerSend(null, 'request-current'), false)
})

test('deferred outgoing AI and API results require the original principal and environment', async () => {
  const token = {
    kind: 'gpt' as const,
    tabId: 'tab-a',
    requestGeneration: 7,
    environmentId: 'env-a',
    environmentGeneration: 3,
    principalId: 'principal-a',
    principalGeneration: 4,
  }
  let current = { ...token }
  let resolveAi: (value: string) => void = () => undefined
  let resolveApi: (value: string) => void = () => undefined
  const ai = new Promise<string>((resolve) => {
    resolveAi = resolve
  })
  const api = new Promise<string>((resolve) => {
    resolveApi = resolve
  })
  const applied: string[] = []
  const applyWhenCurrent = async (promise: Promise<string>) => {
    const value = await promise
    if (isCurrentOutgoingTranslationSession(token, current)) applied.push(value)
  }
  const aiResult = applyWhenCurrent(ai)
  const apiResult = applyWhenCurrent(api)
  current = { ...current, environmentId: 'env-b', environmentGeneration: 4 }
  resolveAi('stale-ai')
  current = { ...current, principalId: 'principal-b', principalGeneration: 5 }
  resolveApi('stale-api')
  await Promise.all([aiResult, apiResult])
  assert.deepEqual(applied, [])
  assert.equal(isCurrentOutgoingTranslationSession(token, token), true)
  const nextRequest = {
    ...current,
    requestGeneration: token.requestGeneration + 1,
  }
  assert.equal(
    isCurrentOutgoingTranslationSession(nextRequest, nextRequest),
    true,
    'a new request can start after the switched session resets loading',
  )
})

test('composer guard failures always produce a visible fail-closed message', () => {
  assert.equal(composerGuardFailureMessage('inspection failed'), 'inspection failed')
  assert.match(composerGuardFailureMessage(''), /未执行发送/)
})
