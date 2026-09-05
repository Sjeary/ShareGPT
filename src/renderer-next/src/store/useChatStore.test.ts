import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { chatViewKey, EMPTY_COMPOSER_DRAFT, useChatStore } from './useChatStore.ts'

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
  assert.equal(useChatStore.getState().firstUnreadByKey['room:team'], 'one')
  useChatStore.getState().clearUnread('room:team')
  useChatStore.getState().incrementUnread('room:team', 'three')
  assert.equal(useChatStore.getState().firstUnreadByKey['room:team'], 'three')
})
