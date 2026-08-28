import assert from 'node:assert/strict'
import test from 'node:test'
import { commitNavTooltipFrame } from './navTooltipFrameProtocol.ts'

test('tooltip commit paints a transparent frame before reveal and acknowledges visible paint', async () => {
  const events: string[] = []
  let frames = 0
  const ready = await commitNavTooltipFrame({
    async nextFrame() {
      frames += 1
      events.push(`frame-${frames}`)
    },
    isCurrent: () => true,
    reveal() {
      events.push('reveal')
    },
  })

  assert.equal(ready, true)
  assert.deepEqual(events, ['frame-1', 'frame-2', 'reveal', 'frame-3', 'frame-4'])
})

test('stale tooltip commit cannot reveal retained content', async () => {
  let frames = 0
  let revealed = false
  const ready = await commitNavTooltipFrame({
    async nextFrame() {
      frames += 1
    },
    isCurrent: () => frames < 2,
    reveal() {
      revealed = true
    },
  })

  assert.equal(ready, false)
  assert.equal(revealed, false)
  assert.equal(frames, 2)
})

test('tooltip invalidated after reveal cannot acknowledge the final frame', async () => {
  let frames = 0
  let revealed = false
  const ready = await commitNavTooltipFrame({
    async nextFrame() {
      frames += 1
    },
    isCurrent: () => frames < 4,
    reveal() {
      revealed = true
    },
  })

  assert.equal(revealed, true)
  assert.equal(ready, false)
  assert.equal(frames, 4)
})
