import assert from 'node:assert/strict'
import test from 'node:test'
import { autoLoginParams } from './autoLogin.ts'

test('auto login restores legacy remembered credentials when auto_login is absent', () => {
  assert.deepEqual(
    autoLoginParams({
      server_url: ' http://example.test/root/ ',
      last_username: ' Alice ',
      remember_password: true,
      saved_password: 'secret',
    }),
    {
      serverUrl: 'http://example.test/root/',
      username: 'Alice',
      password: 'secret',
      rememberPassword: true,
    },
  )
})

test('auto login honors explicit logout without deleting remembered credentials', () => {
  assert.equal(
    autoLoginParams({
      server_url: 'http://example.test',
      last_username: 'Alice',
      remember_password: true,
      auto_login: false,
      saved_password: 'secret',
    }),
    null,
  )
})

test('auto login requires complete remembered credentials', () => {
  assert.equal(
    autoLoginParams({
      server_url: 'http://example.test',
      last_username: 'Alice',
      remember_password: true,
      saved_password: '',
    }),
    null,
  )
})
