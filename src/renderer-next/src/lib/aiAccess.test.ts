import assert from 'node:assert/strict'
import test from 'node:test'

import { canBrowseExternalWeb, canUseAdvancedAi, canUseTranslation } from './aiAccess.ts'

test('a signed-in regular account can translate without gaining advanced environments', () => {
  const regular = { isAdmin: false, advancedAiAllowed: false }
  assert.equal(canUseTranslation('organization', 'session-token', regular), true)
  assert.equal(canUseAdvancedAi('organization', 'session-token', regular), false)
})

test('an administrator always receives advanced AI capability', () => {
  const administrator = { isAdmin: true, advancedAiAllowed: false }
  assert.equal(canUseTranslation('organization', 'session-token', administrator), true)
  assert.equal(canUseAdvancedAi('organization', 'session-token', administrator), true)
})

test('capabilities stay unavailable without a complete signed-in session', () => {
  assert.equal(canUseTranslation('organization', '', { isAdmin: true }), false)
  assert.equal(canUseTranslation('organization', 'session-token', null), false)
  assert.equal(canUseAdvancedAi('organization', '', { isAdmin: true }), false)
})

test('personal translation is local while advanced environments remain organization-managed', () => {
  assert.equal(canUseTranslation('personal', '', null), true)
  assert.equal(canUseAdvancedAi('personal', 'session-token', { isAdmin: true }), false)
  assert.equal(canUseTranslation('chooser', 'session-token', { isAdmin: true }), false)
})

test('external web tabs stay available in Claude without widening Gemini', () => {
  const regular = { isAdmin: false, advancedAiAllowed: false }
  assert.equal(
    canBrowseExternalWeb('claude', 'organization', 'session-token', regular, false),
    true,
  )
  assert.equal(canBrowseExternalWeb('gemini', 'personal', '', null, true), false)
})

test('ChatGPT external web tabs require a personal or enabled advanced workspace', () => {
  const regular = { isAdmin: false, advancedAiAllowed: false }
  const advanced = { isAdmin: false, advancedAiAllowed: true }

  assert.equal(canBrowseExternalWeb('gpt', 'personal', '', null, false), true)
  assert.equal(canBrowseExternalWeb('gpt', 'organization', 'session-token', regular, true), false)
  assert.equal(canBrowseExternalWeb('gpt', 'organization', 'session-token', advanced, false), false)
  assert.equal(canBrowseExternalWeb('gpt', 'organization', 'session-token', advanced, true), true)
  assert.equal(canBrowseExternalWeb('gpt', 'chooser', 'session-token', advanced, true), false)
})
