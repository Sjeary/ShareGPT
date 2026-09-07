import test from 'node:test'
import assert from 'node:assert/strict'
import { createEmojiImageLoader } from './emojiImage.ts'

test('a failed image load can recover on the next request', async () => {
  let calls = 0
  const load = createEmojiImageLoader(async () => {
    if (++calls === 1) throw new Error('offline')
  })
  await assert.rejects(load('combo'), /offline/)
  await load('combo')
  await load('combo')
  assert.equal(calls, 2)
})

test('concurrent combinations share a single pending image request', async () => {
  let calls = 0
  let complete!: () => void
  const load = createEmojiImageLoader(() => {
    calls++
    return new Promise<void>((resolve) => {
      complete = resolve
    })
  })
  const first = load('combo')
  const second = load('combo')
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(calls, 1)
  complete()
  await Promise.all([first, second])
})

test('successful image cache is bounded and keeps recently used entries', async () => {
  const calls: string[] = []
  const load = createEmojiImageLoader(async (url) => {
    calls.push(url)
  }, 2)
  await load('a')
  await load('b')
  await load('a')
  await load('c')
  await load('a')
  await load('b')
  assert.deepEqual(calls, ['a', 'b', 'c', 'b'])
})
