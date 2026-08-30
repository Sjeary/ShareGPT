import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsPrincipalRuntime } from './settingsPrincipalRuntime.ts'
import { createPrincipalUrlPersistence } from './principalUrlPersistence.ts'

const waitForTimer = () => new Promise((resolve) => setTimeout(resolve, 20))

test('a delayed URL write is discarded after switching Principal', async () => {
  const runtime = createSettingsPrincipalRuntime()
  runtime.activate('principal-a')
  const writes: string[] = []
  const persistence = createPrincipalUrlPersistence({
    delayMs: 5,
    runtime,
    patch: async (_section, url) => writes.push(url),
  })

  persistence.persist('gpt', 'https://chatgpt.com/c/alice')
  runtime.activate('principal-b')
  await waitForTimer()

  assert.deepEqual(writes, [])
  persistence.dispose()
})

test('A/B/A generation prevents an old A timer from writing into the new A session', async () => {
  const runtime = createSettingsPrincipalRuntime()
  runtime.activate('principal-a')
  const writes: string[] = []
  const persistence = createPrincipalUrlPersistence({
    delayMs: 5,
    runtime,
    patch: async (_section, url) => writes.push(url),
  })

  persistence.persist('gpt', 'https://chatgpt.com/c/stale-a')
  runtime.activate('principal-b')
  runtime.activate('principal-a')
  await waitForTimer()
  persistence.persist('gpt', 'https://chatgpt.com/c/current-a')
  await waitForTimer()

  assert.deepEqual(writes, ['https://chatgpt.com/c/current-a'])
  persistence.dispose()
})

test('a failed write remains retryable and only a successful write is deduplicated', async () => {
  const runtime = createSettingsPrincipalRuntime()
  runtime.activate('principal-a')
  let attempts = 0
  const persistence = createPrincipalUrlPersistence({
    delayMs: 5,
    runtime,
    patch: async () => {
      attempts += 1
      if (attempts === 1) throw new Error('disk unavailable')
    },
  })

  persistence.persist('gpt', 'https://chatgpt.com/c/retry')
  await waitForTimer()
  persistence.persist('gpt', 'https://chatgpt.com/c/retry')
  await waitForTimer()
  persistence.persist('gpt', 'https://chatgpt.com/c/retry')
  await waitForTimer()

  assert.equal(attempts, 2)
  persistence.dispose()
})

test('a write completed after A/B/A does not suppress the current generation retry', async () => {
  const runtime = createSettingsPrincipalRuntime()
  runtime.activate('principal-a')
  let resolveFirst: (() => void) | undefined
  const writes: string[] = []
  const persistence = createPrincipalUrlPersistence({
    delayMs: 5,
    runtime,
    patch: async (_section, url) => {
      writes.push(url)
      if (writes.length === 1) await new Promise<void>((resolve) => (resolveFirst = resolve))
    },
  })

  persistence.persist('gpt', 'https://chatgpt.com/c/same-url')
  await waitForTimer()
  runtime.activate('principal-b')
  runtime.activate('principal-a')
  resolveFirst?.()
  await Promise.resolve()
  persistence.persist('gpt', 'https://chatgpt.com/c/same-url')
  await waitForTimer()

  assert.deepEqual(writes, ['https://chatgpt.com/c/same-url', 'https://chatgpt.com/c/same-url'])
  persistence.dispose()
})
