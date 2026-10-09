import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeVault } from './merge.ts'

test('conflicts preserve existing conflict copies and reserve distinct file paths', () => {
  const previous = 'note (云端冲突副本).canvas'
  const second = 'note (云端冲突副本 2).canvas'
  const base = { 'note.canvas': 'base', [previous]: 'previous conflict' }
  const ours = { ...base, 'note.canvas': 'local edit' }
  const theirs = { ...base, 'note.canvas': 'cloud edit', [second]: 'another existing note' }
  const report = mergeVault(base, ours, theirs)
  assert.equal(report.merged['note.canvas'], 'local edit')
  assert.equal(report.merged[previous], 'previous conflict')
  assert.equal(report.merged[second], 'another existing note')
  assert.equal(report.conflicts.length, 1)
  assert.equal(report.conflicts[0].copyPath, 'note (云端冲突副本 3).canvas')
  assert.equal(report.merged[report.conflicts[0].copyPath], 'cloud edit')
})
