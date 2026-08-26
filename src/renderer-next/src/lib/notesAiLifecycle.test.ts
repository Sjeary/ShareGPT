import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_NOTES_AI_PROVIDER,
  isCurrentNotesAiPrincipal,
  notesAiProviderFromSettings,
} from './notes/notesAiLifecycle.ts'

test('Notes AI provider restores only the selected principal settings', () => {
  const alice = notesAiProviderFromSettings({
    ai: { baseUrl: 'http://alice.example', apiKey: 'alice-key', model: 'alice-model' },
  })
  const bob = notesAiProviderFromSettings()
  const aliceAgain = notesAiProviderFromSettings({
    ai: { baseUrl: 'http://alice.example', apiKey: 'alice-key', model: 'alice-model' },
  })

  assert.equal(alice.apiKey, 'alice-key')
  assert.deepEqual(bob, DEFAULT_NOTES_AI_PROVIDER)
  assert.deepEqual(aliceAgain, alice)
})

test('Notes AI rejects events after principal or generation changes', () => {
  const request = { principalId: 'alice', principalGeneration: 3 }

  assert.equal(isCurrentNotesAiPrincipal(request, request), true)
  assert.equal(
    isCurrentNotesAiPrincipal(request, { principalId: 'bob', principalGeneration: 4 }),
    false,
  )
  assert.equal(
    isCurrentNotesAiPrincipal(request, { principalId: 'alice', principalGeneration: 4 }),
    false,
  )
  assert.equal(
    isCurrentNotesAiPrincipal(
      { principalId: '', principalGeneration: 5 },
      { principalId: '', principalGeneration: 5 },
    ),
    false,
  )
})
