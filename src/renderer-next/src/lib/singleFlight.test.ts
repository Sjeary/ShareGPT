import assert from 'node:assert/strict'
import test from 'node:test'
import { createSingleFlight } from './singleFlight.ts'

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('concurrent initialization calls share one operation', async () => {
  const coordinator = createSingleFlight<string>()
  const pending = deferred<string>()
  let calls = 0
  const initialize = () => {
    calls += 1
    return pending.promise
  }

  const first = coordinator.run(initialize)
  const second = coordinator.run(initialize)
  pending.resolve('ready')

  assert.equal(await first, 'ready')
  assert.equal(await second, 'ready')
  assert.equal(calls, 1)
})

test('failed initialization can be retried', async () => {
  const coordinator = createSingleFlight<string>()
  await assert.rejects(coordinator.run(async () => Promise.reject(new Error('first failed'))))
  assert.equal(await coordinator.run(async () => 'ready'), 'ready')
})

test('successful initialization can be run again after the shared operation settles', async () => {
  const coordinator = createSingleFlight<number>()
  let calls = 0
  const initialize = async () => {
    calls += 1
    return calls
  }

  assert.equal(await coordinator.run(initialize), 1)
  assert.equal(await coordinator.run(initialize), 2)
  assert.equal(calls, 2)
})
