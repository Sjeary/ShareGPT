export type WebSocketAuthMode = 'query' | 'subprotocol'

export function resolveWebSocketAuthMode(payload: unknown): WebSocketAuthMode {
  if (!payload || typeof payload !== 'object') return 'query'
  const capabilities = (payload as { capabilities?: unknown }).capabilities
  if (!capabilities || typeof capabilities !== 'object') return 'query'
  return (capabilities as { websocketAuth?: unknown }).websocketAuth === 'subprotocol'
    ? 'subprotocol'
    : 'query'
}

export function buildWebSocketConnection(
  serverUrl: string,
  token: string,
  authMode: WebSocketAuthMode,
): { url: string; protocols?: string[] } {
  const parsed = new URL(serverUrl)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('服务地址需要以 http:// 或 https:// 开头')
  }

  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/ws`
  parsed.search = ''
  parsed.hash = ''

  if (authMode === 'subprotocol') {
    return {
      url: parsed.toString(),
      protocols: ['sharegpt', `sharegpt-auth.${token}`],
    }
  }

  // 老服务只支持 query token。新服务会在登录响应中声明 subprotocol，
  // 因此兼容参数不会出现在已升级服务的 URL / 访问日志中。
  parsed.searchParams.set('token', token)
  return { url: parsed.toString() }
}
