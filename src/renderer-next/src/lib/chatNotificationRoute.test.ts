import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveChatNotificationDestination } from './chatNotificationRoute.ts'

test('private notifications select the corresponding conversation', () => {
  assert.deepEqual(
    resolveChatNotificationDestination({
      scope: 'private',
      targetUsername: ' Alice ',
      messageId: ' message-1 ',
    }),
    { activeKey: 'user:Alice', messageId: 'message-1' },
  )
})

test('legacy sender fallback still selects the private conversation', () => {
  assert.deepEqual(resolveChatNotificationDestination({ scope: 'private', from: 'Bob' }), {
    activeKey: 'user:Bob',
    messageId: '',
  })
})

test('room and incomplete private notifications open the default room', () => {
  assert.equal(resolveChatNotificationDestination({ scope: 'subnet' }).activeKey, '')
  assert.equal(resolveChatNotificationDestination({ scope: 'private' }).activeKey, '')
})
