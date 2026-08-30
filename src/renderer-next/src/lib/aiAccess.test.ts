import assert from 'node:assert/strict'
import test from 'node:test'

import { canUseAdvancedAi, canUseTranslation } from './aiAccess.ts'

test('a signed-in regular account can translate without gaining advanced environments', () => {
  const regular = { isAdmin: false, advancedAiAllowed: false }
  assert.equal(canUseTranslation('session-token', regular), true)
  assert.equal(canUseAdvancedAi('session-token', regular), false)
})

test('an administrator always receives advanced AI capability', () => {
  const administrator = { isAdmin: true, advancedAiAllowed: false }
  assert.equal(canUseTranslation('session-token', administrator), true)
  assert.equal(canUseAdvancedAi('session-token', administrator), true)
})

test('capabilities stay unavailable without a complete signed-in session', () => {
  assert.equal(canUseTranslation('', { isAdmin: true }), false)
  assert.equal(canUseTranslation('session-token', null), false)
  assert.equal(canUseAdvancedAi('', { isAdmin: true }), false)
})
