import assert from 'node:assert/strict'
import test from 'node:test'
import { describeUserError, redactErrorDetails } from './userFacingError.ts'
import { requireConfirmedLoginResponse } from './collabLoginTransaction.ts'

const tlsMessage = 'Client network socket disconnected before secure TLS connection was established'

test('IPC TLS failure has an understandable explanation and retains technical evidence', () => {
  const error = new Error(
    `Error invoking remote method 'translation:translate': Error: ${tlsMessage}`,
  )
  const notice = describeUserError(error, '阅读翻译')
  assert.equal(notice.category, 'connection')
  assert.equal(notice.title, '安全连接中断')
  assert.match(notice.description, /网络、代理线路或服务端/)
  assert.match(notice.suggestion, /重试/)
  assert.match(notice.details, /操作：阅读翻译/)
  assert.ok(notice.details.includes(tlsMessage))
  assert.doesNotMatch(notice.details, /Error invoking remote method/)
  assert.doesNotMatch(notice.description + notice.suggestion, /封号|纯净|禁用.*证书/)
})

test('specific causes distinguish DNS, certificates, proxy, timeout and disconnection', () => {
  const cases = [
    ['ENOTFOUND', '找不到服务器地址'],
    ['EAI_AGAIN', '找不到服务器地址'],
    ['ERR_NAME_NOT_RESOLVED', '找不到服务器地址'],
    ['CERT_HAS_EXPIRED', '无法验证服务器的安全证书'],
    ['ERR_CERT_AUTHORITY_INVALID', '无法验证服务器的安全证书'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', '无法验证服务器的安全证书'],
    ['ETIMEDOUT', '连接超时'],
    ['ERR_TIMED_OUT', '连接超时'],
    ['ECONNREFUSED', '服务器拒绝连接'],
    ['ERR_PROXY_CONNECTION_FAILED', '代理连接失败'],
    ['HTTP 407', '代理连接失败'],
    ['proxy connection failed: ECONNREFUSED', '代理连接失败'],
    ['ECONNRESET', '连接意外中断'],
    ['ERR_CONNECTION_CLOSED', '连接意外中断'],
    ['Failed to fetch', '暂时无法连接服务'],
  ]
  for (const [message, title] of cases) {
    // Fetch and IPC layers may wrap the underlying cause with a generic message.
    const cause = Object.assign(new Error(message), { code: message })
    const notice = describeUserError(new Error('无法连接到服务器', { cause }))
    assert.equal(notice.title, title, message)
    assert.equal(notice.category, 'connection', message)
  }
})

test('HTTP responses retain status and do not mark service or network failures as bad credentials', async () => {
  const cases = [
    [401, 'credentials', '身份验证未通过'],
    [403, 'permission', '服务拒绝了这次请求'],
    [429, 'service', '请求暂时受到限制'],
    [503, 'service', '服务暂时不可用'],
  ] as const
  for (const [status, category, title] of cases) {
    let caught: unknown
    try {
      await requireConfirmedLoginResponse(new Response('fixture failure', { status }))
    } catch (error) {
      caught = error
    }
    const notice = describeUserError(caught, '登录')
    assert.equal(notice.category, category)
    assert.equal(notice.title, title)
    assert.ok(notice.details.includes(`HTTP ${status}`))
  }
  for (const [message, category] of [
    ['翻译接口错误 401', 'credentials'],
    ['接口错误 429: quota exhausted', 'service'],
    ['翻译接口错误 503', 'service'],
    ['登录失败（401）', 'credentials'],
  ]) {
    assert.equal(describeUserError(message).category, category, message)
  }
  assert.equal(describeUserError('密码错误').category, 'credentials')
  assert.equal(describeUserError('Failed to fetch').category, 'connection')
  assert.equal(describeUserError('request id: 401').category, 'other')
})

test('technical details redact secrets, URL userinfo/paths/parameters and local paths', () => {
  const raw = [
    tlsMessage,
    'https://fixture-user:fixture-pass@api.example.com/private-account/chat?key=query-secret#hash-secret',
    'socks5://proxy-user:proxy-pass@proxy.example.com:1080',
    'socks5h://secret-user:secret-password@proxy.example.com:1080',
    'wss://secret-user:secret-password@socket.example.com/private-channel?key=websocket-secret',
    'Authorization: Bearer auth-secret',
    'Cookie: session=cookie-secret; token=second-cookie',
    'api_key="key-secret" password=pass-secret refresh_token=refresh-secret',
    'Bearer bearer-secret',
    'sk-fixture-test-key eyJhbGci.testPayload.testSignature',
    '/Users/example/private-profile/session /home/example/private/file C:\\Users\\example\\private\\file',
  ].join('\n')
  const notice = describeUserError(raw)
  for (const secret of [
    'secret-user',
    'secret-password',
    'websocket-secret',
    'private-channel',
    'fixture-user',
    'fixture-pass',
    'private-account',
    'query-secret',
    'hash-secret',
    'proxy-user',
    'proxy-pass',
    'auth-secret',
    'cookie-secret',
    'second-cookie',
    'key-secret',
    'pass-secret',
    'refresh-secret',
    'bearer-secret',
    'sk-fixture-test-key',
    'eyJhbGci',
    'private-profile',
    '/home/example',
    'C:\\Users',
  ]) {
    assert.ok(!notice.details.includes(secret), secret)
  }
  assert.ok(notice.details.includes(tlsMessage))
  assert.ok(notice.details.includes('https://api.example.com/…'))
  assert.ok(notice.details.includes('socks5://proxy.example.com:1080/…'))
})

test('unknown objects, cyclic causes and throwing properties produce bounded safe messages', () => {
  const error = {
    message: '不允许使用此服务',
    body: 'private-content',
    headers: { secret: 'private-key' },
    cause: undefined as unknown,
  }
  error.cause = error
  const notice = describeUserError(error)
  assert.equal(notice.description, error.message)
  assert.doesNotMatch(notice.details, /private-content|private-key/)
  assert.equal(notice.details.match(/不允许使用此服务/g)?.length, 1)
  assert.equal(
    describeUserError({
      get message() {
        throw new Error('getter')
      },
    }).category,
    'other',
  )
  assert.equal(describeUserError(undefined).title, '操作未完成')
  assert.equal(
    describeUserError('unclassified internal failure').description,
    '应用未能完成这次操作，具体错误保留在技术详情中。',
  )
  assert.ok(redactErrorDetails('x'.repeat(10000)).length <= 2400)
})
