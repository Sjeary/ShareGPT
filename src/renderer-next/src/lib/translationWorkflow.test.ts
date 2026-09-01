import assert from 'node:assert/strict'
import test from 'node:test'
import { buildComposerPreview, stoppedComposerState } from './translationWorkflow.ts'

test('translated composer previews contain only the translated text', () => {
  assert.equal(buildComposerPreview(' 你好 ', ' Hello ', 'translated'), 'Hello')
})

test('bilingual composer previews preserve the source and translation as separate content', () => {
  assert.equal(
    buildComposerPreview(' 你好 ', ' Hello ', 'bilingual'),
    '原文：\n你好\n\n译文：\nHello',
  )
})

test('composer previews stay empty until a translation exists', () => {
  assert.equal(buildComposerPreview('你好', '   ', 'translated'), '')
  assert.equal(buildComposerPreview('你好', '', 'bilingual'), '')
})

test('stopping a first composer translation discards incomplete output', () => {
  assert.deepEqual(stoppedComposerState(null), {
    translation: '',
    preview: '',
    previewEdited: false,
    phase: 'stopped',
    status: '已停止；未完成内容不会写入网页',
  })
})

test('stopping a retry restores only the previous complete composer preview', () => {
  assert.deepEqual(
    stoppedComposerState({
      translation: 'Hello',
      preview: 'Hello',
      previewEdited: false,
      phase: 'ready',
    }),
    {
      translation: 'Hello',
      preview: 'Hello',
      previewEdited: false,
      phase: 'ready',
      status: '已停止；已保留上一次完整发送预览',
    },
  )
})
