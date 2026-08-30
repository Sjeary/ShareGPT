import assert from 'node:assert/strict'
import test from 'node:test'
import { createLatestAttemptCoordinator } from './latestAttempt.ts'

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('an older login response cannot apply after a newer login starts', async () => {
  const attempts = createLatestAttemptCoordinator()
  const firstResponse = deferred<string>()
  const applied: string[] = []
  const firstAttempt = attempts.begin()
  const first = firstResponse.promise.then((identity) => {
    attempts.assertCurrent(firstAttempt)
    applied.push(identity)
  })

  const secondAttempt = attempts.begin()
  attempts.assertCurrent(secondAttempt)
  applied.push('Bob')
  firstResponse.resolve('Alice')

  await assert.rejects(first, /旧操作已取消/)
  assert.deepEqual(applied, ['Bob'])
})

test('invalidate cancels an in-flight login attempt', () => {
  const attempts = createLatestAttemptCoordinator()
  const attempt = attempts.begin()
  attempts.invalidate()
  assert.throws(() => attempts.assertCurrent(attempt), /旧操作已取消/)
})
