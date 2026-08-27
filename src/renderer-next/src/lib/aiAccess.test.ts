import assert from 'node:assert/strict'
import test from 'node:test'
import { canUseAdvancedAi, canUseTranslation } from './aiAccess.ts'

test('translation is available to every authenticated user', () => {
  assert.equal(canUseTranslation(null, 'token'), false)
  assert.equal(canUseTranslation({ username: '' }, 'token'), false)
  assert.equal(canUseTranslation({ username: 'basic-user' }, ''), false)
  assert.equal(
    canUseTranslation(
      {
        username: 'basic-user',
        isAdmin: false,
        advancedAiAllowed: false,
        routeAuthorizationVerified: false,
      },
      'verified-token',
    ),
    true,
  )
})

test('advanced AI capability is independent from current route synchronization', () => {
  assert.equal(
    canUseAdvancedAi(
      {
        username: 'basic-user',
        isAdmin: false,
        advancedAiAllowed: false,
        routeAuthorizationVerified: true,
      },
      'verified-token',
    ),
    false,
  )
  assert.equal(
    canUseAdvancedAi(
      {
        username: 'advanced-user',
        isAdmin: false,
        advancedAiAllowed: true,
        routeAuthorizationVerified: false,
      },
      'verified-token',
    ),
    true,
  )
  assert.equal(
    canUseAdvancedAi(
      {
        username: 'advanced-user',
        isAdmin: false,
        advancedAiAllowed: true,
        routeAuthorizationVerified: true,
      },
      'verified-token',
    ),
    true,
  )
  assert.equal(
    canUseAdvancedAi(
      {
        username: 'admin-user',
        isAdmin: true,
        advancedAiAllowed: false,
        routeAuthorizationVerified: true,
      },
      'verified-token',
    ),
    true,
  )
  assert.equal(
    canUseAdvancedAi(
      {
        username: '',
        isAdmin: true,
        advancedAiAllowed: true,
        routeAuthorizationVerified: true,
      },
      'verified-token',
    ),
    false,
  )
})
