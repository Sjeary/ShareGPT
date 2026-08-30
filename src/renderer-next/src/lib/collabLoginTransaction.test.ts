import assert from 'node:assert/strict'
import test from 'node:test'
import {
  completeCollabLoginTransaction,
  requireConfirmedLoginResponse,
} from './collabLoginTransaction.ts'
import { runAuthoritativeBootstrapRefresh } from './collabBootstrapAuthorization.ts'

interface HarnessOptions {
  bootstrap: () => Promise<unknown>
  activate?: () => Promise<{ principalId: string }>
  persist?: () => Promise<void>
  current?: () => boolean
  rollback?: () => Promise<void>
  rollbackActivated?: (principal: { principalId: string }) => Promise<void>
  discard?: () => Promise<void>
}

function loginHarness(options: HarnessOptions) {
  const events: string[] = []
  let authorizedRouteIds = ['stale-route']
  const transaction = completeCollabLoginTransaction({
    isCurrent: options.current ?? (() => true),
    assertCurrent: () => {
      events.push('assert')
    },
    activatePrincipal:
      options.activate ??
      (async () => {
        events.push('activate')
        return { principalId: 'principal-alice' }
      }),
    applyPrincipal: () => {
      events.push('apply-principal')
    },
    persistPrincipalSettings: async () => {
      events.push('persist-principal')
      await options.persist?.()
    },
    enableAdminCapabilities: async () => {
      events.push('admin')
    },
    refreshProxyAuthorization: () =>
      runAuthoritativeBootstrapRefresh({
        invalidate: async () => {
          events.push('invalidate-routes')
          authorizedRouteIds = []
        },
        fetchBootstrap: options.bootstrap,
        applyBootstrap: async (raw) => {
          events.push('apply-routes')
          authorizedRouteIds = (raw as { proxyRoutes: Array<{ id: string }> }).proxyRoutes.map(
            (route) => route.id,
          )
        },
      }),
    publishSession: () => {
      events.push('publish-session')
    },
    rollbackLocalPrincipal: async () => {
      events.push('rollback-local')
      await options.rollback?.()
    },
    rollbackActivatedPrincipalIfOwned: options.rollbackActivated
      ? async (principal) => {
          events.push('rollback-activated')
          await options.rollbackActivated?.(principal)
        }
      : undefined,
    discardIssuedToken: async () => {
      events.push('discard-token')
      await options.discard?.()
    },
    reportProxyAuthorizationFailure: () => {
      events.push('route-warning')
    },
  })
  return {
    transaction,
    events,
    authorizedRouteIds: () => authorizedRouteIds,
  }
}

for (const scenario of [
  {
    name: 'missing proxyRoutes',
    bootstrap: async () => ({ sender: {}, update: {} }),
  },
  {
    name: 'capabilities unavailable',
    bootstrap: async () => ({
      proxyRoutes: [],
      capabilities: { proxyRoutes: { available: false, authoritative: false } },
    }),
  },
  {
    name: 'bootstrap timeout',
    bootstrap: async () => {
      throw new Error('读取线路授权超时')
    },
  },
  {
    name: 'bootstrap 500',
    bootstrap: async () => {
      throw new Error('读取客户端配置失败（500）')
    },
  },
]) {
  test(`${scenario.name}: collaboration login succeeds with routes fail closed`, async () => {
    const harness = loginHarness({ bootstrap: scenario.bootstrap })
    const result = await harness.transaction
    assert.equal(result.proxyAuthorizationReady, false)
    assert.deepEqual(harness.authorizedRouteIds(), [])
    assert.ok(harness.events.includes('publish-session'))
    assert.ok(harness.events.includes('route-warning'))
    assert.equal(harness.events.includes('discard-token'), false)
    assert.equal(harness.events.includes('rollback-local'), false)
  })
}

test('authoritative routes apply before collaboration session is published', async () => {
  const harness = loginHarness({
    bootstrap: async () => ({ proxyRoutes: [{ id: 'route-us' }] }),
  })
  const result = await harness.transaction
  assert.equal(result.proxyAuthorizationReady, true)
  assert.deepEqual(harness.authorizedRouteIds(), ['route-us'])
  assert.ok(harness.events.indexOf('apply-routes') < harness.events.indexOf('publish-session'))
})

test('invalid credentials fail before a Principal transaction', async () => {
  const response = new Response('密码错误', { status: 401 })
  await assert.rejects(requireConfirmedLoginResponse(response), /密码错误/)
})

test('fatal Principal settings persistence failure discards token and rolls back local', async () => {
  const harness = loginHarness({
    bootstrap: async () => ({ proxyRoutes: [] }),
    persist: async () => {
      throw new Error('settings disk unavailable')
    },
  })
  await assert.rejects(harness.transaction, /settings disk unavailable/)
  assert.equal(harness.events.filter((event) => event === 'discard-token').length, 1)
  assert.equal(harness.events.filter((event) => event === 'rollback-local').length, 1)
  assert.equal(harness.events.includes('publish-session'), false)
})

test('fatal Principal activation failure rolls back local for the latest attempt', async () => {
  const events: string[] = []
  const harness = loginHarness({
    bootstrap: async () => ({ proxyRoutes: [] }),
    activate: async () => {
      events.push('activate-failed')
      throw new Error('principal migration write failed')
    },
  })
  await assert.rejects(harness.transaction, /principal migration write failed/)
  assert.deepEqual(events, ['activate-failed'])
  assert.equal(harness.events.filter((event) => event === 'discard-token').length, 1)
  assert.equal(harness.events.filter((event) => event === 'rollback-local').length, 1)
})

test('a fatal session publication failure discards token and rolls back local', async () => {
  const events: string[] = []
  await assert.rejects(
    completeCollabLoginTransaction({
      isCurrent: () => true,
      assertCurrent: () => undefined,
      activatePrincipal: async () => ({ principalId: 'principal-alice' }),
      applyPrincipal: () => undefined,
      persistPrincipalSettings: async () => undefined,
      enableAdminCapabilities: async () => undefined,
      refreshProxyAuthorization: async () => undefined,
      publishSession: () => {
        events.push('publish-started')
        throw new Error('session store failed')
      },
      rollbackLocalPrincipal: async () => {
        events.push('rollback-local')
      },
      discardIssuedToken: async () => {
        events.push('discard-token')
      },
    }),
    /session store failed/,
  )
  assert.deepEqual(events, ['publish-started', 'discard-token', 'rollback-local'])
})

test('a stale failure after activation rolls back the Principal only while it still owns main', async () => {
  let mainPrincipalId = 'principal-alice'
  const harness = loginHarness({
    bootstrap: async () => ({ proxyRoutes: [] }),
    persist: async () => {
      throw new Error('stale persistence failure')
    },
    current: () => false,
    rollbackActivated: async (principal) => {
      if (mainPrincipalId === principal.principalId) mainPrincipalId = 'local-device'
    },
  })
  await assert.rejects(harness.transaction, /stale persistence failure/)
  assert.equal(harness.events.filter((event) => event === 'discard-token').length, 1)
  assert.equal(harness.events.includes('rollback-local'), false)
  assert.equal(harness.events.filter((event) => event === 'rollback-activated').length, 1)
  assert.equal(mainPrincipalId, 'local-device')
})

test('a stale ownership-aware rollback is a no-op after main advances to a newer Principal', async () => {
  let mainPrincipalId = 'principal-bob'
  const harness = loginHarness({
    bootstrap: async () => ({ proxyRoutes: [] }),
    persist: async () => {
      throw new Error('stale persistence failure')
    },
    current: () => false,
    rollbackActivated: async (principal) => {
      if (mainPrincipalId === principal.principalId) mainPrincipalId = 'local-device'
    },
  })

  await assert.rejects(harness.transaction, /stale persistence failure/)
  assert.equal(harness.events.filter((event) => event === 'discard-token').length, 1)
  assert.equal(harness.events.includes('rollback-local'), false)
  assert.equal(harness.events.filter((event) => event === 'rollback-activated').length, 1)
  assert.equal(mainPrincipalId, 'principal-bob')
})

test('failed local Principal recovery preserves the fatal cause and discards the token once', async () => {
  const fatalError = new Error('settings disk unavailable')
  const recoveryError = new Error('local Principal clear failed')
  const harness = loginHarness({
    bootstrap: async () => ({ proxyRoutes: [] }),
    persist: async () => {
      throw fatalError
    },
    rollback: async () => {
      throw recoveryError
    },
    discard: async () => {
      throw new Error('logout endpoint unavailable')
    },
  })

  await assert.rejects(harness.transaction, (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.match(error.message, /本地账号状态未能恢复/)
    assert.equal(error.cause, fatalError)
    assert.equal((error as Error & { rollbackError?: unknown }).rollbackError, recoveryError)
    return true
  })
  assert.equal(harness.events.filter((event) => event === 'discard-token').length, 1)
  assert.equal(harness.events.filter((event) => event === 'rollback-local').length, 1)
})
