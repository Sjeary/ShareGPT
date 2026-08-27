import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWebSocketConnection, resolveWebSocketAuthMode } from './collabWebSocket.ts'

test('uses legacy query auth only when the server does not advertise websocket capabilities', () => {
  assert.equal(resolveWebSocketAuthMode(null), 'query')
  assert.equal(resolveWebSocketAuthMode({ capabilities: {} }), 'query')
  assert.equal(
    resolveWebSocketAuthMode({ capabilities: { websocketAuth: 'subprotocol' } }),
    'subprotocol',
  )
})

test('builds a subprotocol-authenticated websocket without putting the token in the URL', () => {
  const connection = buildWebSocketConnection(
    'https://collab.example.com/team/',
    'secret-token',
    'subprotocol',
  )
  assert.equal(connection.url, 'wss://collab.example.com/team/ws')
  assert.deepEqual(connection.protocols, ['sharegpt', 'sharegpt-auth.secret-token'])
  assert.equal(connection.url.includes('secret-token'), false)
})

test('builds the old query-authenticated websocket for an unadvertised legacy server', () => {
  const connection = buildWebSocketConnection(
    'http://127.0.0.1:8088/base',
    'token-with-safe_chars',
    'query',
  )
  assert.equal(connection.url, 'ws://127.0.0.1:8088/base/ws?token=token-with-safe_chars')
  assert.equal(connection.protocols, undefined)
})
