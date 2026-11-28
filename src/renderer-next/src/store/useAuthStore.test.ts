import test from 'node:test'
import assert from 'node:assert/strict'
import { useAuthStore } from './useAuthStore.ts'

test('startup auto-entry is consumed once and session transitions never rearm it', () => {
  useAuthStore.setState({ startupEntryAvailable: true })
  assert.equal(useAuthStore.getState().claimStartupEntry(), true)
  assert.equal(useAuthStore.getState().claimStartupEntry(), false)
  useAuthStore.getState().clearSession()
  assert.equal(useAuthStore.getState().claimStartupEntry(), false)
  useAuthStore.setState({ startupEntryAvailable: true })
  useAuthStore
    .getState()
    .setSession({
      token: 'synthetic',
      password: '',
      profile: { username: 'A', displayName: 'A', avatar: '' },
    })
  useAuthStore.getState().clearSession()
  assert.equal(useAuthStore.getState().claimStartupEntry(), false)
})
