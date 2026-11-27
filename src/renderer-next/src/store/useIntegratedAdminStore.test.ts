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
