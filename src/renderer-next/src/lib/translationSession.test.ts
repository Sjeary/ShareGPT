import assert from 'node:assert/strict'
import test from 'node:test'

import {
  hasPendingAutoTranslation,
  isCurrentTranslationRequest,
  isTranslationTarget,
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
