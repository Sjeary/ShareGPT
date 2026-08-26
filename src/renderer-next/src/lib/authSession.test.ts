import assert from 'node:assert/strict'
import test from 'node:test'

import { isCurrentRouteRefreshSession, type CurrentRouteSession } from './authSession.ts'

test('a deferred route refresh cannot apply after another principal activates', async () => {
  const captured = {
    principalId: 'principal-a',
    serverUrl: 'http://server-a.test',
    username: 'Alice',
    acceptedTokens: ['token-a', 'token-a-refreshed'],
  }
  let current: CurrentRouteSession = {
    principalId: 'principal-a',
    serverUrl: 'http://server-a.test',
    username: 'Alice',
    token: 'token-a',
  }
  let resolveBootstrap: (value: string) => void = () => undefined
  const bootstrap = new Promise<string>((resolve) => {
    resolveBootstrap = resolve
  })
  const applied: string[] = []
  const refresh = (async () => {
    const value = await bootstrap
    if (isCurrentRouteRefreshSession(captured, current)) applied.push(value)
  })()

  current = {
    principalId: 'principal-b',
    serverUrl: 'http://server-b.test',
    username: 'Bob',
    token: 'token-b',
  }
  resolveBootstrap('routes-for-a')
  await refresh

  assert.deepEqual(applied, [])
})

test('a silent relogin refresh accepts only the captured old or replacement token', () => {
  const captured = {
    principalId: 'principal-a',
    serverUrl: 'http://server.test',
    username: 'Alice',
    acceptedTokens: ['token-old', 'token-new'],
  }
  const current = {
    principalId: 'principal-a',
    serverUrl: 'http://server.test',
    username: 'Alice',
  }

  assert.equal(isCurrentRouteRefreshSession(captured, { ...current, token: 'token-old' }), true)
  assert.equal(isCurrentRouteRefreshSession(captured, { ...current, token: 'token-new' }), true)
  assert.equal(isCurrentRouteRefreshSession(captured, { ...current, token: 'token-other' }), false)
})
