import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldShowUnreadMarker } from './chatUnreadMarker.ts'

test('id-less system messages never render an empty unread marker', () => {
  assert.equal(shouldShowUnreadMarker('', ''), false)
  assert.equal(shouldShowUnreadMarker('', 'message-1'), false)
  assert.equal(shouldShowUnreadMarker('system-message', ''), false)
})

test('the unread marker renders only on its exact message', () => {
  assert.equal(shouldShowUnreadMarker('message-1', 'message-1'), true)
  assert.equal(shouldShowUnreadMarker('message-2', 'message-1'), false)
})
