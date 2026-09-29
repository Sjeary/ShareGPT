import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertChatTextLength, MAX_CHAT_TEXT_LENGTH } from './chatText.ts'

test('chat length contract accepts the full boundary and rejects overflow without altering drafts', () => {
  const draft = 'x'.repeat(MAX_CHAT_TEXT_LENGTH + 1)
  assert.doesNotThrow(() => assertChatTextLength(draft.slice(1)))
  assert.throws(() => assertChatTextLength(draft), /草稿已保留/)
  assert.equal(draft.length, MAX_CHAT_TEXT_LENGTH + 1)
  assert.throws(() => assertChatTextLength('🍅'.repeat(MAX_CHAT_TEXT_LENGTH / 2 + 1)), /8000/)
})
