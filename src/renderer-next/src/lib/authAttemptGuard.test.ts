import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createLatestAttemptCoordinator } from './latestAttempt.ts'
import { runGuardedInviteRegistration } from './authAttemptGuard.ts'

describe('runGuardedInviteRegistration', () => {
  it('blocks stale invite registration A when password login B starts before A resolves', async () => {
    const coordinator = createLatestAttemptCoordinator()
    const calls: string[] = []
    let resolveRegisterA!: (value: { username: string }) => void

    const taskA = runGuardedInviteRegistration({
      coordinator,
      register: () =>
        new Promise((resolve) => {
          resolveRegisterA = resolve
        }),
      afterRegistered: async () => {
        calls.push('afterRegistered:A')
      },
      loginWithAttempt: async (username) => {
        calls.push(`login:${username}`)
        return { username }
      },
      onCompleted: () => calls.push('completed:A'),
      onLoginFallback: () => calls.push('fallback:A'),
    })

    // User switches to password login B while A is in flight.
    const attemptB = coordinator.begin()
    calls.push(`login:B:${attemptB}`)

    // Delayed invite registration A now resolves.
    resolveRegisterA({ username: 'alice' })
    const resultA = await taskA

    assert.equal(resultA.stale, true)
    assert.deepEqual(calls, [`login:B:${attemptB}`])
  })

  it('cancels invite registration when form unmounts mid-flight without touching newer intent', async () => {
    const coordinator = createLatestAttemptCoordinator()
    const controller = new AbortController()
    const calls: string[] = []
    let resolveRegister!: (value: { username: string }) => void

    const task = runGuardedInviteRegistration({
      coordinator,
      signal: controller.signal,
      register: (signal) =>
        new Promise((resolve, reject) => {
          resolveRegister = resolve
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
      afterRegistered: async () => {
        calls.push('afterRegistered')
      },
      loginWithAttempt: async (username) => {
        calls.push(`login:${username}`)
        return { username }
      },
      onCompleted: () => calls.push('completed'),
      onLoginFallback: () => calls.push('fallback'),
    })

    controller.abort()
    resolveRegister({ username: 'late-user' })
    const result = await task

    assert.equal(result.stale, true)
    assert.deepEqual(calls, [])
  })

  it('completes auto-login cleanly when invite registration remains the latest attempt', async () => {
    const coordinator = createLatestAttemptCoordinator()
    const calls: string[] = []

    const result = await runGuardedInviteRegistration({
      coordinator,
      register: async () => {
        calls.push('register')
        return { username: 'newmember' }
      },
      afterRegistered: async () => {
        calls.push('afterRegistered')
      },
      loginWithAttempt: async (username, attempt) => {
        coordinator.assertCurrent(attempt)
        calls.push(`login:${username}`)
        return { username }
      },
      onCompleted: (profile) => calls.push(`completed:${profile.username}`),
    })

    assert.equal(result.stale, false)
    assert.deepEqual(result.profile, { username: 'newmember' })
    assert.deepEqual(calls, [
      'register',
      'afterRegistered',
      'login:newmember',
      'completed:newmember',
    ])
  })
})
