export interface UserFacingError {
  category: 'connection' | 'credentials' | 'permission' | 'service' | 'other'
  title: string
  description: string
  suggestion: string
  details: string
}

function field(error: unknown, name: string): unknown {
  try {
    return error && typeof error === 'object' ? Reflect.get(error, name) : undefined
  } catch {
    return undefined
  }
}

export function errorText(error: unknown): string {
  const value = field(error, 'message') ?? error
  return (typeof value === 'string' || typeof value === 'number' ? String(value) : '')
    .replace(/^(?:Error:\s*)?Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

// Only error messages/codes are collected, never request bodies, settings or stacks.
export function redactErrorDetails(value: string): string {
  return value
    .replace(
      /(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]+/gi,
      '[认证头已隐藏]',
    )
    .replace(/(?:\/Users\/|\/home\/|[a-z]:\\Users\\)[^\s"'<>]+/gi, '[本机路径已隐藏]')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi, (raw) => {
      try {
        const url = new URL(raw)
        if (!url.host || url.protocol === 'file:') return '[地址已隐藏]'
        return `${url.protocol}//${url.host}${url.pathname !== '/' ? '/…' : '/'}${url.search || url.hash ? ' [参数已隐藏]' : ''}`
      } catch {
        return '[地址已隐藏]'
      }
    })
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"'}]+/gi, '[认证信息已隐藏]')
    .replace(
      /((?:["']?)(?:authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|passwd|secret|密钥|密码)(?:["']?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      '$1[已隐藏]',
    )
    .replace(/\bsk-[a-z0-9_-]+/gi, '[密钥已隐藏]')
    .replace(/\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi, '[令牌已隐藏]')
    .slice(0, 2400)
}

export function describeUserError(error: unknown, context = '当前操作'): UserFacingError {
  const messages: string[] = []
  const visited = new Set<unknown>()
  let current = error
  for (let depth = 0; current && depth < 4 && !visited.has(current); depth += 1) {
    visited.add(current)
    const code =
      typeof field(current, 'code') === 'string' ? (field(current, 'code') as string) : ''
    const message = errorText(current)
    const status = field(current, 'status')
    const http =
      typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
        ? `HTTP ${status}`
        : ''
    if (code || message || http) messages.push([http, code, message].filter(Boolean).join(': '))
    current = field(current, 'cause')
  }
  const raw = messages.join('\n')
  const match = (pattern: RegExp) => pattern.test(raw)
  const result = (
    category: UserFacingError['category'],
    title: string,
    description: string,
    suggestion: string,
  ): UserFacingError => ({
    category,
    title,
    description,
    suggestion,
    details: redactErrorDetails(
      `操作：${context}\n提示：${title}\n技术信息：${raw || '未提供错误详情'}`,
    ),
  })

  if (
    match(
      /ERR_(?:CERT_|TLS_CERT)|CERT_HAS_EXPIRED|CERT_NOT_YET_VALID|SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT|certificate (?:has expired|verify failed|is not yet valid)|self.signed certificate/i,
    )
  ) {
    return result(
      'connection',
      '无法验证服务器的安全证书',
      '服务器证书未通过验证，安全连接已停止。',
      '请检查设备日期和时间，并核对服务地址。仍然失败时，请联系服务提供方检查证书。',
    )
  }
  if (
    match(
      /ETIMEDOUT|ESOCKETTIMEDOUT|ERR_(?:CONNECTION_)?TIMED_OUT|timed?\s*out|连接.*超时|请求.*超时/i,
    )
  ) {
    return result(
      'connection',
      '连接超时',
      '在等待时间内没有收到服务器响应，当前操作未完成。',
      '请检查网络后重试。如果只有这个服务一直超时，请联系管理员检查服务或代理线路。',
    )
  }
  if (
    match(/before secure TLS connection|TLS handshake|ERR_SSL_|EPROTO|SSL routines|TLS connection/i)
  ) {
    return result(
      'connection',
      match(/disconnected before secure TLS connection/i) ? '安全连接中断' : '安全连接失败',
      '与服务器建立安全连接时失败。当前网络、代理线路或服务端异常都可能导致这种情况。',
      '请稍后重试；若仍失败，检查当前网络和代理线路是否可用。团队提供的线路请联系管理员排查。',
    )
  }
  if (match(/ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|ERR_DNS_|getaddrinfo/i)) {
    return result(
      'connection',
      '找不到服务器地址',
      '未能把服务器域名解析为可连接的地址。',
      '请核对地址拼写，确认网络正常后重试；仍失败时，请联系管理员检查域名和 DNS。',
    )
  }
  if (
    match(
      /ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED|SOCKS.*(?:failed|refused)|proxy.*(?:failed|refused)|\b(?:HTTP\s*|status(?: code)?[\s:=]*)407\b|407 Proxy Authentication/i,
    )
  ) {
    return result(
      'connection',
      '代理连接失败',
      '当前代理未能完成连接，或代理需要有效的认证信息。',
      '请在“网络 / 代理”中检查代理状态和线路。团队托管的线路请联系管理员处理。',
    )
  }
  if (match(/ECONNREFUSED|ERR_CONNECTION_REFUSED|connection refused/i)) {
    return result(
      'connection',
      '服务器拒绝连接',
      '目标地址的服务没有接受连接，可能尚未启动，或地址、端口不正确。',
      '请核对服务地址和端口；如果地址由团队提供，请联系管理员确认服务已启动。',
    )
  }
  if (
    match(
      /ECONNRESET|EPIPE|ERR_CONNECTION_(?:RESET|CLOSED|ABORTED)|socket hang up|socket disconnected/i,
    )
  ) {
    return result(
      'connection',
      '连接意外中断',
      '与服务器的连接在请求完成前断开，当前操作未完成。',
      '请检查网络和代理状态后重试；持续出现时，将技术详情提供给服务管理员。',
    )
  }
  if (
    match(
      /ERR_INTERNET_DISCONNECTED|ENETUNREACH|EHOSTUNREACH|ERR_NETWORK_CHANGED|Failed to fetch|NetworkError|Load failed|无法连接到服务器|无法连接到服务地址/i,
    )
  ) {
    return result(
      'connection',
      '暂时无法连接服务',
      '请求未能完成。仅凭当前错误还无法确定是网络、服务地址还是服务器的问题。',
      '请确认网络可用并核对服务地址，再重试。团队服务持续不可用时，请联系管理员。',
    )
  }
  if (
    match(
      /(?:\bHTTP\s*|\bstatus(?: code)?[\s:=]*|响应[\s：:]*|(?:翻译)?接口错误\s*|登录失败[（(])(?:401)\b|\b401\s+Unauthorized\b|invalid credentials|账号或密码(?:错误|不正确)|用户名或密码(?:错误|不正确)|(?:^|\n)密码错误$/i,
    )
  ) {
    return result(
      'credentials',
      '身份验证未通过',
      '服务未接受当前账号、密码或 API 密钥。',
      '请检查当前服务的登录信息；使用团队提供的账号或接口时，可联系管理员确认是否仍有效。',
    )
  }
  if (
    match(
      /(?:\bHTTP\s*|\bstatus(?: code)?[\s:=]*|响应[\s：:]*|(?:翻译)?接口错误\s*|登录失败[（(])(?:403)\b|\b403\s+Forbidden\b/i,
    )
  ) {
    return result(
      'permission',
      '服务拒绝了这次请求',
      '服务器未允许当前请求；这条响应本身不能确定具体限制原因。',
      '请确认账号拥有所需权限，或联系服务管理员查看限制原因。',
    )
  }
  if (
    match(
      /(?:\bHTTP\s*|\bstatus(?: code)?[\s:=]*|响应[\s：:]*|(?:翻译)?接口错误\s*|登录失败[（(])(?:429)\b|Too Many Requests|rate.?limit/i,
    )
  ) {
    return result(
      'service',
      '请求暂时受到限制',
      '服务要求减少请求，或当前可用额度不足。',
      '请稍后再试，避免连续重复提交；持续出现时，请检查服务额度或联系管理员。',
    )
  }
  if (
    match(
      /(?:\bHTTP\s*|\bstatus(?: code)?[\s:=]*|响应[\s：:]*|(?:翻译)?接口错误\s*|登录失败[（(])(?:5\d\d)\b|\b50[234]\s+(?:Bad Gateway|Service Unavailable|Gateway Timeout)/i,
    )
  ) {
    return result(
      'service',
      '服务暂时不可用',
      '服务器或它依赖的上游服务未能完成请求。',
      '请稍后重试；如果持续发生，请联系服务管理员。',
    )
  }
  const message = redactErrorDetails(errorText(error))
  const readable = /[\u3400-\u9fff]/.test(message) && !/ERR_[A-Z_]+/.test(message)
  return result(
    'other',
    '操作未完成',
    readable ? message : '应用未能完成这次操作，具体错误保留在技术详情中。',
    readable ? '' : '请重试；如果问题持续发生，复制技术详情反馈给管理员。',
  )
}
