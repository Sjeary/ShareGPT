import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import {
  chatViewKey,
  EMPTY_COMPOSER_DRAFT,
  roomConversationKey,
  useChatStore,
  type ChatMessage,
} from './useChatStore.ts'

function roomMessage(id: string, timestamp: string, serverSequence?: number): ChatMessage {
  return {
    id,
    serverSequence,
    type: 'chat',
    scope: 'subnet',
    from: 'peer',
    to: '',
    username: 'peer',
    displayName: 'Peer',
    avatar: '',
    text: id,
    attachments: [],
    replyTo: null,
    forwardedFrom: null,
    timestamp,
    readAt: '',
    readBy: [],
    edited: false,
    editedAt: '',
    subnetKey: 'team',
    subnetLabel: 'team',
    system: false,
    recalled: false,
    recalledAt: '',
    reactions: {},
  }
}

beforeEach(() => {
  useChatStore.getState().reset()
  useChatStore.setState({ composerDrafts: {} })
})

test('drafts restore A/B/A and keep case-sensitive principals and conversations separate', () => {
  const a = chatViewKey('server-path:Alice', 'user:peer')
  const b = chatViewKey('server-path:alice', 'user:peer')
  const room = chatViewKey('server-path:Alice', 'room:team')
  const patch = useChatStore.getState().patchComposerDraft
  patch(a, { text: 'A draft' })
  patch(b, { text: 'B draft' })
  patch(room, { text: 'room draft' })
  useChatStore.getState().clearGroupCaches()
  useChatStore.getState().reset()
  assert.equal(useChatStore.getState().composerDrafts[a].text, 'A draft')
  assert.equal(useChatStore.getState().composerDrafts[b].text, 'B draft')
  assert.equal(useChatStore.getState().composerDrafts[room].text, 'room draft')
  assert.notEqual(a, chatViewKey('other-path:Alice', 'user:peer'))
})

test('editing and cancelling preserve the unsent text and attachment', () => {
  const key = chatViewKey('A', 'room:team')
  const patch = useChatStore.getState().patchComposerDraft
  const attachment = {
    kind: 'file' as const,
    name: 'draft.txt',
    mime: 'text/plain',
    size: 1,
    dataUrl: 'data:text/plain,a',
  }
  patch(key, { text: 'unsent', attachment })
  patch(key, { edit: { id: 'old', preview: 'edited text' } })
  patch(key, { edit: null })
  assert.deepEqual(useChatStore.getState().composerDrafts[key], {
    ...EMPTY_COMPOSER_DRAFT,
    text: 'unsent',
    attachment,
  })
})

test('clearing one completed draft does not remove another conversation', () => {
  const patch = useChatStore.getState().patchComposerDraft
  patch('first', { text: 'one' })
  patch('second', { text: 'two' })
  patch('first', EMPTY_COMPOSER_DRAFT)
  assert.equal(useChatStore.getState().composerDrafts.first, undefined)
  assert.equal(useChatStore.getState().composerDrafts.second.text, 'two')
  patch('', { text: 'unscoped' })
  assert.equal(useChatStore.getState().composerDrafts[''], undefined)
})

test('reading positions stay isolated and unread marker advances after clearing a batch', () => {
  useChatStore.setState({ readingPositions: {} })
  const a = chatViewKey('A', 'room:team')
  const b = chatViewKey('B', 'room:team')
  const first = {
    anchorId: 'first',
    offset: -12,
    scrollTop: 400,
    atBottom: false,
    unreadMarkerId: '',
  }
  useChatStore.getState().saveReadingPosition(a, first)
  useChatStore.getState().saveReadingPosition(b, { ...first, scrollTop: 50 })
  useChatStore.getState().clearGroupCaches()
  assert.equal(useChatStore.getState().readingPositions[a].scrollTop, 400)
  assert.equal(useChatStore.getState().readingPositions[b].scrollTop, 50)
  useChatStore.getState().incrementUnread('room:team', 'one')
  useChatStore.getState().incrementUnread('room:team', 'two')
  useChatStore.getState().incrementUnread('room:team', 'one')
  assert.deepEqual(useChatStore.getState().unreadMessageIdsByKey['room:team'], ['one', 'two'])
  assert.equal(useChatStore.getState().unreadByKey['room:team'], 2)
  useChatStore.getState().clearUnread('room:team')
  useChatStore.getState().incrementUnread('room:team', 'three')
  assert.deepEqual(useChatStore.getState().unreadMessageIdsByKey['room:team'], ['three'])
  useChatStore.getState().reset()
  assert.deepEqual(useChatStore.getState().unreadMessageIdsByKey, {})
})

test('unread anchors stay within retained history without losing the total unread count', () => {
  const key = roomConversationKey('team')
  const store = useChatStore.getState()
  store.setRoomScope('team')
  for (let index = 0; index < 305; index++) {
    const message = roomMessage(`unread-${index}`, new Date(1000 + index).toISOString())
    store.upsertMessage(message)
    store.incrementUnread(key, message.id)
  }
  assert.equal(useChatStore.getState().unreadByKey[key], 305)
  assert.equal(useChatStore.getState().unreadMessageIdsByKey[key].length, 300)
  assert.equal(useChatStore.getState().unreadMessageIdsByKey[key][0], 'unread-5')
  store.clearUnread(key)
  assert.equal(useChatStore.getState().unreadMessageIdsByKey[key], undefined)
  assert.equal(useChatStore.getState().unreadByKey[key], undefined)
})

test('public room stays in server order when cached, history, and live messages arrive out of order', () => {
  const key = roomConversationKey('team')
  useChatStore.setState({ roomScope: 'team' })

  useChatStore.getState().hydrate({
    [key]: [
      roomMessage('third', '2026-09-07T10:00:00.003Z', 3),
      roomMessage('first', '2026-09-07T10:00:00.001Z', 1),
    ],
  })
  useChatStore.getState().mergeMessages([roomMessage('second', '2026-09-07T10:00:00.002Z', 2)])

  assert.deepEqual(
    useChatStore.getState().messagesByConversation[key].map((message) => message.id),
    ['first', 'second', 'third'],
  )

  // 旧服务器没有 serverSequence 时仍按服务端 timestamp 修复迟到历史。
  useChatStore.getState().upsertMessage(roomMessage('legacy-middle', '2026-09-07T10:00:00.001Z'))
  assert.deepEqual(
    useChatStore.getState().messagesByConversation[key].map((message) => message.id),
    ['first', 'legacy-middle', 'second', 'third'],
  )

  useChatStore
    .getState()
    .mergeMessages([
      roomMessage('same-millisecond-later', '2026-09-07T10:00:00.004Z', 5),
      roomMessage('same-millisecond-earlier', '2026-09-07T10:00:00.004Z', 4),
    ])
  assert.deepEqual(
    useChatStore
      .getState()
      .messagesByConversation[key].slice(-2)
      .map((message) => message.id),
    ['same-millisecond-earlier', 'same-millisecond-later'],
  )
})
