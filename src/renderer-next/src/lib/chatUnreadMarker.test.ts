import assert from 'node:assert/strict'
import test from 'node:test'
import { unreadMarkerIndex } from './chatUnreadMarker.ts'

test('presence and empty IDs never create an unread boundary', () => {
  const messages = [
    { id: '', system: true },
    { id: 'presence', system: true },
  ]
  assert.equal(unreadMarkerIndex(messages), -1)
  assert.equal(unreadMarkerIndex(messages, ['', 'presence']), -1)
})

test('one boundary follows display order rather than delivery order, even for duplicate rows', () => {
  const messages = [{ id: '' }, { id: 'older' }, { id: 'older' }, { id: 'newer' }]
  assert.equal(unreadMarkerIndex(messages, ['newer', 'older']), 1)
  assert.equal(unreadMarkerIndex(messages, []), -1)
})

test('trimmed unread messages fall forward only to another pending unread message', () => {
  const messages = [{ id: 'presence', system: true }, { id: 'read' }, { id: 'unread' }]
  assert.equal(unreadMarkerIndex(messages, ['trimmed', 'unread']), 2)
  assert.equal(unreadMarkerIndex(messages, ['trimmed']), -1)
})
