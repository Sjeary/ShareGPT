import assert from 'node:assert/strict'
import test from 'node:test'
import { buildComposerPreview } from './translationWorkflow.ts'

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
