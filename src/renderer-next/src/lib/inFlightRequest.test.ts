import test from 'node:test'
import assert from 'node:assert/strict'
import { coalesceInFlight } from './inFlightRequest.ts'

test('identical in-flight requests share one production operation', async () => {
  const requests = new Map<string, Promise<string>>()
  let calls = 0
  let release = () => {}
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const load = async () => {
    calls += 1
    await blocked
    return `result-${calls}`
  }

  const first = coalesceInFlight(requests, 'gpt:tab-a', load)
  const second = coalesceInFlight(requests, 'gpt:tab-a', load)
  await Promise.resolve()
  assert.equal(calls, 1)
  release()
  assert.deepEqual(await Promise.all([first, second]), ['result-1', 'result-1'])
  assert.equal(requests.size, 0)
})

test('a failed request is removed so the next operation can retry', async () => {
  const requests = new Map<string, Promise<string>>()
  await assert.rejects(
    coalesceInFlight(requests, 'claude:tab-a', async () => {
      throw new Error('offline')
    }),
    /offline/,
  )
  assert.equal(await coalesceInFlight(requests, 'claude:tab-a', async () => 'ready'), 'ready')
})
