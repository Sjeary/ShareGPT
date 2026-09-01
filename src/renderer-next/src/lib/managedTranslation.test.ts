import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cancelManagedTranslation,
  fetchManagedTranslationProfiles,
  managedTranslate,
} from './managedTranslation.ts'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('托管翻译配置只消费服务端公开元数据', async () => {
  let requestUrl = ''
  let authorization = ''
  const catalog = await fetchManagedTranslationProfiles('https://team.example.com/', 'token-1', {
    fetchImpl: async (input, init) => {
      requestUrl = String(input)
      authorization = String((init?.headers as Record<string, string>)?.Authorization || '')
      return jsonResponse({
        version: 1,
        defaultProfileId: 'default-ai',
        profiles: [{ id: 'default-ai', name: '团队默认', type: 'ai', model: 'gpt-5-mini' }],
      })
    },
  })
  assert.equal(requestUrl, 'https://team.example.com/api/translation/profiles')
  assert.equal(authorization, 'Bearer token-1')
  assert.deepEqual(catalog.profiles, [
    { id: 'default-ai', name: '团队默认', type: 'ai', model: 'gpt-5-mini' },
  ])
  assert.equal(JSON.stringify(catalog).includes('apiKey'), false)
  assert.equal(JSON.stringify(catalog).includes('baseUrl'), false)
})

test('托管翻译将 profileId 和 requestId 交给协作服务器且支持取消', async () => {
  const controller = new AbortController()
  let body: Record<string, unknown> = {}
  const result = await managedTranslate(
    'http://team.example.com',
    'token-2',
    {
      profileId: 'profile-a',
      text: '你好',
      source: 'auto',
      target: 'en',
      style: 'natural',
      glossary: '',
      requestId: 'request-12345678',
    },
    {
      signal: controller.signal,
      fetchImpl: async (_input, init) => {
        assert.equal(init?.signal, controller.signal)
        body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        return jsonResponse({ translatedText: 'Hello', profileId: 'profile-a' })
      },
    },
  )
  assert.equal(body.requestId, 'request-12345678')
  assert.equal(body.profileId, 'profile-a')
  assert.deepEqual(result, { translatedText: 'Hello', profileId: 'profile-a' })
})

test('托管翻译不会把鉴权失败伪装成空配置', async () => {
  await assert.rejects(
    fetchManagedTranslationProfiles('https://team.example.com', 'expired', {
      fetchImpl: async () => new Response('未授权', { status: 401 }),
    }),
    /登录已失效/,
  )
})

test('托管翻译停止请求使用同一 requestId 和登录身份', async () => {
  let requestUrl = ''
  let body: Record<string, unknown> = {}
  const cancelled = await cancelManagedTranslation(
    'https://team.example.com/',
    'token-3',
    'request-12345678',
    {
      fetchImpl: async (input, init) => {
        requestUrl = String(input)
        assert.equal((init?.headers as Record<string, string>)?.Authorization, 'Bearer token-3')
        body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        return jsonResponse({ ok: true, cancelled: true })
      },
    },
  )
  assert.equal(requestUrl, 'https://team.example.com/api/translation/cancel')
  assert.equal(body.requestId, 'request-12345678')
  assert.equal(cancelled, true)
})
