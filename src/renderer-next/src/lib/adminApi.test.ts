import test from 'node:test'
import assert from 'node:assert/strict'
import {
  adminFetch,
  createAdminApi,
  AdminApiError,
  AdminUnsupportedError,
  normalizeServerUrl,
} from './adminApi.ts'
import { AuthExpiredError } from '../types/admin.ts'

test('admin transport preserves endpoint paths, encodes filters and sends bearer without cookies or redirects', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(
      String(input),
      'https://example.test/team/api/admin/ai-usage?from=a%26b&service=gpt',
    )
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer token')
    assert.equal(init?.credentials, 'omit')
    assert.equal(init?.redirect, 'error')
    return Response.json({ totalQueries: 4 })
  })
  const result = await createAdminApi('https://EXAMPLE.test/team/', 'token').loadAiUsage({
    from: 'a&b',
  })
  assert.equal(result.totalQueries, 4)
  assert.equal(normalizeServerUrl('http://localhost:8000/team/'), 'http://localhost:8000/team')
  assert.throws(() => normalizeServerUrl('https://user:password@example.test'), AdminApiError)
})

test('JSON and plain-text errors are extracted and only 401/403 expire authentication', async (t) => {
  for (const status of [401, 403, 409, 500]) {
    const mock = t.mock.method(
      globalThis,
      'fetch',
      async () => new Response(JSON.stringify({ error: { message: 'reason' } }), { status }),
    )
    await assert.rejects(
      adminFetch('https://example.test', 'token', '/api/admin/users'),
      (error: Error) => {
        assert.equal(error.message, 'reason')
        assert.equal(error instanceof AuthExpiredError, status === 401 || status === 403)
        return true
      },
    )
    mock.mock.restore()
  }
  t.mock.method(globalThis, 'fetch', async () => new Response('plain failure', { status: 400 }))
  await assert.rejects(
    adminFetch('https://example.test', 'token', '/api/admin/users'),
    /plain failure/,
  )
})

test('timeouts cover the response body; cancellation before fetch sends nothing', async (t) => {
  const fetchMock = t.mock.method(
    globalThis,
    'fetch',
    async (_url: unknown, init?: RequestInit) => ({
      status: 200,
      ok: true,
      text: () =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          }),
        ),
    }),
  )
  await assert.rejects(
    adminFetch('https://example.test', 'token', '/api/admin/users', { timeoutMs: 5 }),
    { name: 'TimeoutError' },
  )
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    adminFetch('https://example.test', 'token', '/api/admin/users', { signal: controller.signal }),
    { name: 'AbortError' },
  )
  assert.equal(fetchMock.mock.callCount(), 1)
})

test('malformed successful payloads fail and unsupported destructive actions do not call the network', async (t) => {
  const mock = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('<html>bad upstream</html>'),
  )
  await assert.rejects(createAdminApi('https://example.test', 'token').loadUsers(), /无效的 JSON/)
  const api = createAdminApi('https://example.test', 'token')
  for (const action of [
    () => api.deleteUser('user'),
    () => api.deleteFeedback('id'),
    () => api.clearProxyMissing(),
    () => api.deleteRelease('v1'),
  ]) {
    await assert.rejects(action(), AdminUnsupportedError)
  }
  assert.equal(mock.mock.callCount(), 1)
})

test('legacy release upload uses raw file bytes and escaped metadata, not multipart or a filesystem path', async (t) => {
  const file = new Blob(['installer fixture'])
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const parsed = new URL(String(url))
    assert.equal(parsed.pathname, '/api/admin/releases/upload')
    assert.equal(parsed.searchParams.get('fileName'), 'test & app.exe')
    assert.equal(parsed.searchParams.get('notes'), 'a&b')
    assert.equal(init?.body, file)
    assert.equal(new Headers(init?.headers).get('content-type'), 'application/octet-stream')
    return Response.json({ bootstrap: { update: { version: '1' } } })
  })
  const result = await createAdminApi('https://example.test', 'token').uploadRelease({
    platform: 'windows',
    fileName: 'test & app.exe',
    notes: 'a&b',
    file,
  })
  assert.equal(result.bootstrap.update.version, '1')
})
