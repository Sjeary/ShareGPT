import assert from 'node:assert/strict'
import test from 'node:test'

import { runAuthLoginSingleFlight } from './authLoginFlight.ts'

test('concurrent auth login calls share exactly one server operation', async () => {
  let calls = 0
  let release: ((value: string) => void) | undefined
  const first = runAuthLoginSingleFlight(
    () =>
      new Promise<string>((resolve) => {
        calls += 1
        release = resolve
      }),
  )
  const second = runAuthLoginSingleFlight(async () => {
    calls += 1
    return 'second-token'
  })
  assert.strictEqual(first, second)
  assert.equal(calls, 1)
  release?.('current-token')
  assert.equal(await second, 'current-token')
})

test('auth login single-flight releases after failure', async () => {
  await assert.rejects(
    runAuthLoginSingleFlight(async () => {
      throw new Error('failed')
    }),
    /failed/,
  )
  assert.equal(await runAuthLoginSingleFlight(async () => 'retry-token'), 'retry-token')
})
