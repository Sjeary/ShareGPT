import assert from 'node:assert/strict'
import test from 'node:test'

import {
  composerGuardFailureMessage,
  hasPendingAutoTranslation,
  isComposerGuardEligible,
  isCurrentSelectionTranslationSession,
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

test('queued selection translation events require the current principal, environment and page', () => {
  const current = {
    kind: 'claude' as const,
    tabId: 'tab-a',
    principalId: 'principal-a',
    environmentId: 'env-a',
    environmentGeneration: 3,
    navigationGeneration: 7,
  }

  assert.equal(isCurrentSelectionTranslationSession(current, current), true)
  assert.equal(
    isCurrentSelectionTranslationSession({ ...current, principalId: 'principal-b' }, current),
    false,
  )
  assert.equal(
    isCurrentSelectionTranslationSession(
      { ...current, environmentId: 'env-b', environmentGeneration: 4 },
      current,
    ),
    false,
  )
  assert.equal(isCurrentSelectionTranslationSession({ ...current, tabId: 'tab-b' }, current), false)
  assert.equal(
    isCurrentSelectionTranslationSession({ ...current, navigationGeneration: 8 }, current),
    false,
  )
})

test('composer confirmation eligibility follows the authenticated translation session', () => {
  assert.equal(isComposerGuardEligible(null, 'token'), false)
  assert.equal(isComposerGuardEligible({}, 'token'), false)
  assert.equal(isComposerGuardEligible({ username: '' }, 'token'), false)
  assert.equal(isComposerGuardEligible({ username: 'basic-user' }, ''), false)
  assert.equal(isComposerGuardEligible({ username: 'basic-user' }, 'token'), true)
  assert.equal(isComposerGuardEligible({ username: 'admin-user' }, 'token'), true)
  assert.equal(
    isComposerGuardEligible({ username: 'advanced-user' }, 'token'),
    true,
    'managed-route authorization is independent from translation access',
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
    navigationGeneration: 2,
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

test('same-tab navigation aborts a deferred outgoing result before write or send', async () => {
  const token = {
    kind: 'claude' as const,
    tabId: 'tab-a',
    requestGeneration: 1,
    environmentId: 'env-a',
    environmentGeneration: 1,
    principalId: 'principal-a',
    principalGeneration: 1,
    navigationGeneration: 7,
  }
  let current = { ...token }
  let resolveSlow: (value: string) => void = () => undefined
  const slow = new Promise<string>((resolve) => {
    resolveSlow = resolve
  })
  const writes: string[] = []
  const deferred = (async () => {
    const translated = await slow
    if (!isCurrentOutgoingTranslationSession(token, current)) {
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    }
    writes.push(translated)
  })()

  current = { ...current, navigationGeneration: 8 }
  resolveSlow('stale translation')
  await assert.rejects(deferred, { name: 'AbortError' })
  assert.deepEqual(writes, [])
})

test('composer guard failures always produce a visible fail-closed message', () => {
  assert.equal(composerGuardFailureMessage('inspection failed'), 'inspection failed')
  assert.match(composerGuardFailureMessage(''), /未执行发送/)
})
