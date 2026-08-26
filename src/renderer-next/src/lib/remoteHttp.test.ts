import assert from 'node:assert/strict'
import test from 'node:test'

import { REMOTE_HTTP_WARNING, usesRemoteHttp } from './remoteHttp.ts'

test('public HTTP endpoints show the plaintext transmission warning', () => {
  assert.equal(usesRemoteHttp('http://api.example.test/v1'), true)
  assert.match(REMOTE_HTTP_WARNING, /内容和接口密钥会以明文/)
})

test('HTTPS and exact loopback HTTP endpoints do not show the remote warning', () => {
  assert.equal(usesRemoteHttp('https://api.example.test/v1'), false)
  assert.equal(usesRemoteHttp('http://localhost:5000/v1'), false)
  assert.equal(usesRemoteHttp('http://127.0.0.1:5000/v1'), false)
  assert.equal(usesRemoteHttp('http://[::1]:5000/v1'), false)
})

test('invalid and non-HTTP endpoint values do not produce a misleading HTTP warning', () => {
  assert.equal(usesRemoteHttp(''), false)
  assert.equal(usesRemoteHttp('not a url'), false)
  assert.equal(usesRemoteHttp('ftp://api.example.test/v1'), false)
})
