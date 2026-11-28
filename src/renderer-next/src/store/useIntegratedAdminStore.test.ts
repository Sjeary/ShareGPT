import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createIntegratedAdminStore,
  connectIntegratedAdminSession,
} from './useIntegratedAdminStore.ts'
import { AuthExpiredError } from '../types/admin.ts'
import type { IntegratedAdminSession } from '../types/admin.ts'

const A: IntegratedAdminSession = {
  serverUrl: 'https://example.test/team',
  token: 'a',
  username: 'Admin',
  isAdmin: true,
}
const B = { ...A, token: 'b', username: 'admin' }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('non-admin has no requests; binding an admin performs no eager fetching and only the selected page loads', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    assert.equal(String(url), `${A.serverUrl}/api/admin/invites`)
    return Response.json({ invites: [] })
  })
  const store = createIntegratedAdminStore()
  store.getState().bindSession({ ...A, isAdmin: false })
  await assert.rejects(store.getState().loadUsers(), AuthExpiredError)
  await assert.rejects(
    store.getState().createUser({ username: 'new', password: 'password' }),
    AuthExpiredError,
  )
  store.getState().bindSession(A)
  assert.equal(mock.mock.callCount(), 0)
  await store.getState().loadTab('invites')
  assert.equal(mock.mock.callCount(), 1)
  assert.equal(store.getState().loaded.invites, true)
  assert.equal(store.getState().loaded.users, undefined)
})

test('A/B/A switching aborts and drops old results, including loading/error state and returned values', async (t) => {
  const first = deferred<Response>()
  let signal: AbortSignal | null | undefined
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    signal = init?.signal
    return first.promise
  })
  const store = createIntegratedAdminStore()
  store.getState().bindSession(A)
  const pending = store.getState().loadUsers()
  store.getState().bindSession(B)
  assert.equal(signal?.aborted, true)
  store.getState().bindSession(A)
  first.resolve(Response.json({ users: [{ username: 'obsolete' }] }))
  assert.equal(await pending, undefined)
  assert.deepEqual(store.getState().users, [])
  assert.deepEqual(store.getState().loading, {})
  assert.deepEqual(store.getState().errors, {})
})

test('endpoint path, username case, token, admin loss and logout each invalidate the session', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ users: [{ username: 'loaded' }] }))
  const store = createIntegratedAdminStore()
  for (const next of [
    { ...A, serverUrl: 'https://example.test/other' },
    B,
    { ...A, token: 'new' },
    { ...A, isAdmin: false },
    null,
  ]) {
    store.getState().bindSession(A)
    await store.getState().loadUsers()
    store.getState().bindSession(next)
    assert.deepEqual(store.getState().users, [])
    assert.equal(store.getState().overview, null)
  }
  store.getState().bindSession(A)
  await store.getState().loadUsers()
  store.getState().bindSession({ ...A, serverUrl: `${A.serverUrl}/` })
  assert.equal(store.getState().users.length, 1)
})

test('older filter responses never replace a newer report or release its loading flag', async (t) => {
  const first = deferred<Response>()
  const second = deferred<Response>()
  let calls = 0
  t.mock.method(globalThis, 'fetch', () => (++calls === 1 ? first.promise : second.promise))
  const store = createIntegratedAdminStore()
  store.getState().bindSession(A)
  const p1 = store.getState().loadAiUsage({ service: 'gpt' })
  const p2 = store.getState().loadAiUsage({ service: 'gemini' })
  first.resolve(Response.json({ service: 'gpt' }))
  assert.equal(await p1, undefined)
  assert.equal(store.getState().loading.aiUsage, true)
  second.resolve(Response.json({ service: 'gemini' }))
  await p2
  assert.equal(store.getState().aiUsage?.service, 'gemini')
  assert.equal(store.getState().loading.aiUsage, false)
})

test('current authentication failure clears all data; late old failure cannot clear the next account', async (t) => {
  let response = deferred<Response>()
  t.mock.method(globalThis, 'fetch', () => response.promise)
  const store = createIntegratedAdminStore()
  store.getState().bindSession(A)
  const old = store.getState().loadUsers()
  store.getState().bindSession(B)
  response.resolve(new Response('expired', { status: 401 }))
  assert.equal(await old, undefined)
  assert.equal(store.getState().session?.token, B.token)
  response = deferred<Response>()
  const current = store.getState().loadUsers()
  response.resolve(new Response('forbidden', { status: 403 }))
  await assert.rejects(current, AuthExpiredError)
  assert.equal(store.getState().session, null)
  assert.deepEqual(store.getState().loading, {})
})

test('account changes cancel queued writes and prevent post-mutation refreshes from the old account', async (t) => {
  const result = deferred<Response>()
  const called = deferred<void>()
  const mock = t.mock.method(globalThis, 'fetch', () => {
    called.resolve()
    return result.promise
  })
  const store = createIntegratedAdminStore()
  store.getState().bindSession(A)
  const first = store.getState().createUser({ username: 'new', password: 'password' })
  const second = store.getState().createInvite({ note: 'must not send' })
  await called.promise
  store.getState().bindSession(B)
  result.resolve(Response.json({ user: { username: 'new' } }))
  assert.equal(await first, undefined)
  assert.equal(await second, undefined)
  assert.equal(mock.mock.callCount(), 1)
})

test('application-lifetime source subscription clears immediately while panel is unmounted', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ users: [{ username: 'loaded' }] }))
  let session: IntegratedAdminSession | null = A
  let listener = () => {}
  let unsubscribed = false
  const store = createIntegratedAdminStore()
  const dispose = connectIntegratedAdminSession(
    {
      getSession: () => session,
      subscribe: (fn) => {
        listener = fn
        return () => {
          unsubscribed = true
        }
      },
    },
    store,
  )
  await store.getState().loadUsers()
  session = null
  listener()
  assert.equal(store.getState().session, null)
  assert.deepEqual(store.getState().users, [])
  dispose()
  assert.equal(unsubscribed, true)
})

test('single profile mutations serialize fresh catalog edits and keep unrelated secret metadata intact', async (t) => {
  const preserved = { id: 'keep', apiKeyConfigured: true, apiKeyHint: '***1234' }
  let catalog = {
    version: 1,
    defaultProfileId: 'remove',
    encryptionReady: true,
    profiles: [preserved, { id: 'remove' }],
  }
  const requests: string[] = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    requests.push(init?.method || 'GET')
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body))
      catalog = { ...catalog, ...body }
    }
    return Response.json(catalog)
  })
  const store = createIntegratedAdminStore()
  store.getState().bindSession(A)
  await Promise.all([
    store.getState().deleteTranslationProfile('remove'),
    store.getState().deleteTranslationProfile('not-present'),
  ])
  assert.deepEqual(requests, ['GET', 'PUT', 'GET', 'PUT'])
  assert.equal(store.getState().translationCatalog?.defaultProfileId, '')
  assert.deepEqual(store.getState().translationCatalog?.profiles, [preserved])
})

test('ordinary server failures retain the session and last successful data for retry', async (t) => {
  let failing = false
  t.mock.method(globalThis, 'fetch', async () =>
    failing
      ? new Response('temporarily unavailable', { status: 503 })
      : Response.json({ users: [{ username: 'saved' }] }),
  )
  const store = createIntegratedAdminStore()
  store.getState().bindSession(A)
  await store.getState().loadUsers()
  failing = true
  await assert.rejects(store.getState().loadUsers(), /temporarily unavailable/)
  assert.equal(store.getState().session?.token, A.token)
  assert.equal(store.getState().users[0].username, 'saved')
  assert.equal(store.getState().loading.users, false)
  assert.equal(store.getState().errors.users, 'temporarily unavailable')
})

test('a refresh during a save waits for the committed catalog instead of hiding its result', async (t) => {
  const writeResponse = deferred<Response>()
  const started = deferred<void>()
  const calls: string[] = []
  t.mock.method(globalThis, 'fetch', (_url: unknown, init?: RequestInit) => {
    calls.push(init?.method || 'GET')
    if (init?.method === 'PUT') {
      started.resolve()
      return writeResponse.promise
    }
    return Promise.resolve(Response.json({ version: 1, routes: [{ id: 'saved' }] }))
  })
  const store = createIntegratedAdminStore()
  store.getState().bindSession(A)
  const save = store.getState().saveProxyRoutes([])
  await started.promise
  const refresh = store.getState().loadProxyRoutes()
  assert.deepEqual(calls, ['PUT'])
  writeResponse.resolve(Response.json({ version: 1, routes: [{ id: 'saved' }] }))
  await Promise.all([save, refresh])
  assert.deepEqual(calls, ['PUT', 'GET'])
  assert.equal(store.getState().proxyRoutes[0].id, 'saved')
})

test('unrelated application events preserve an exchanged legacy session and loaded data', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ users: [{ username: 'loaded' }] }))
  let source: IntegratedAdminSession | null = A
  let notify = () => {}
  const store = createIntegratedAdminStore()
  const dispose = connectIntegratedAdminSession(
    {
      getSession: () => source && { ...source },
      subscribe: (listener) => {
        notify = listener
        return () => {}
      },
    },
    store,
  )
  store.getState().bindSession({ ...A, token: 'legacy-admin-token' })
  await store.getState().loadUsers()
  let updates = 0
  const off = store.subscribe(() => updates++)
  for (let i = 0; i < 50; i++) notify()
  assert.equal(updates, 0, 'navigation/status events must not invalidate admin data')
  assert.equal(store.getState().session?.token, 'legacy-admin-token')
  assert.equal(store.getState().users[0].username, 'loaded')
  source = { ...A, serverUrl: A.serverUrl + '/' }
  notify()
  assert.equal(updates, 0, 'equivalent endpoint spelling is the same source')
  source = { ...A, token: 'new-desktop-session' }
  notify()
  assert.equal(store.getState().session?.token, 'new-desktop-session')
  assert.deepEqual(store.getState().users, [])
  source = null
  notify()
  assert.equal(store.getState().session, null)
  updates = 0
  for (let i = 0; i < 50; i++) notify()
  assert.equal(updates, 0, 'ordinary member/personal events must not emit empty resets')
  off()
  dispose()
})

test('expired admin data stays cleared until the desktop authentication source changes', () => {
  let source = A
  let notify = () => {}
  const store = createIntegratedAdminStore()
  const dispose = connectIntegratedAdminSession(
    {
      getSession: () => source,
      subscribe: (listener) => {
        notify = listener
        return () => {}
      },
    },
    store,
  )
  store.getState().clear()
  notify()
  assert.equal(store.getState().session, null)
  source = { ...A, token: 'renewed' }
  notify()
  assert.equal(store.getState().session?.token, 'renewed')
  dispose()
})

test('overlapping identical reads share one request and both callers receive its result', async (t) => {
  const response = deferred<Response>()
  const fetch = t.mock.method(globalThis, 'fetch', () => response.promise.then((r) => r.clone()))
  const store = createIntegratedAdminStore()
  store.getState().bindSession(A)
  const first = store.getState().loadUsers()
  const second = store.getState().loadOverview()
  assert.equal(fetch.mock.callCount(), 1)
  response.resolve(Response.json({ users: [{ username: 'loaded' }] }))
  assert.deepEqual(await first, await second)
  await store.getState().loadUsers()
  assert.equal(fetch.mock.callCount(), 2, 'a later explicit refresh still reaches the server')
})

test('a pre-save read cannot be shared by a post-save refresh', async (t) => {
  const oldRead = deferred<Response>()
  let reads = 0
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'PUT') return Response.json({ version: 1, routes: [{ id: 'saved' }] })
    if (++reads === 1) return oldRead.promise
    return Response.json({ version: 1, routes: [{ id: 'saved' }] })
  })
  const store = createIntegratedAdminStore()
  store.getState().bindSession(A)
  const stale = store.getState().loadProxyRoutes()
  const save = store.getState().saveProxyRoutes([])
  const refresh = store.getState().loadProxyRoutes()
  await Promise.all([save, refresh])
  assert.equal(reads, 2)
  oldRead.resolve(Response.json({ version: 1, routes: [{ id: 'obsolete' }] }))
  assert.equal(await stale, undefined)
  assert.equal(store.getState().proxyRoutes[0].id, 'saved')
})

test('equal filters coalesce but A/B/A filter changes still make the final selection authoritative', async (t) => {
  const responses = [deferred<Response>(), deferred<Response>(), deferred<Response>()]
  let requests = 0
  t.mock.method(globalThis, 'fetch', () => responses[requests++].promise)
  const store = createIntegratedAdminStore()
  store.getState().bindSession(A)
  const oldA = store.getState().loadAiUsage({ service: 'gpt' })
  const sameA = store.getState().loadAiUsage({ service: 'gpt' })
  assert.equal(requests, 1)
  const b = store.getState().loadAiUsage({ service: 'claude' })
  const newA = store.getState().loadAiUsage({ service: 'gpt' })
  assert.equal(requests, 3)
  responses[2].resolve(Response.json({ service: 'gpt', marker: 'latest' }))
  await newA
  responses[0].resolve(Response.json({ service: 'gpt', marker: 'obsolete' }))
  responses[1].resolve(Response.json({ service: 'claude' }))
  assert.deepEqual(await Promise.all([oldA, sameA, b]), [undefined, undefined, undefined])
  assert.equal(store.getState().aiUsage?.service, 'gpt')
  assert.equal(store.getState().loading.aiUsage, false)
})
