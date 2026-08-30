import assert from 'node:assert/strict'
import test from 'node:test'

import { REMOTE_HTTP_WARNING, usesRemoteHttp } from './remoteHttp.ts'

test('only non-loopback HTTP endpoints require the plaintext warning', () => {
  assert.equal(usesRemoteHttp('http://api.example/v1'), true)
  assert.equal(usesRemoteHttp('https://api.example/v1'), false)
  assert.equal(usesRemoteHttp('http://localhost:5000'), false)
  assert.equal(usesRemoteHttp('http://127.0.0.1:5000'), false)
  assert.equal(usesRemoteHttp('http://[::1]:5000'), false)
  assert.equal(usesRemoteHttp('not a URL'), false)
})

test('the warning explicitly covers both content and API keys', () => {
  assert.match(REMOTE_HTTP_WARNING, /内容/)
  assert.match(REMOTE_HTTP_WARNING, /接口密钥/)
  assert.match(REMOTE_HTTP_WARNING, /明文/)
  assert.match(REMOTE_HTTP_WARNING, /允许/)
})
