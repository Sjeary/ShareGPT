export interface ParsedInviteLink {
  serverUrl: string
  code: string
}

export function buildInviteLink(serverUrl: string, code: string): string {
  const cleanServer = String(serverUrl || '')
    .trim()
    .replace(/\/+$/, '')
  const cleanCode = String(code || '').trim()
  if (!cleanServer || !cleanCode) return ''
  return `sharegpt://invite?server=${encodeURIComponent(cleanServer)}&code=${encodeURIComponent(cleanCode)}`
}

// 解析管理员分享的邀请链接；兼容整段聊天粘贴文本、sharegpt://invite?... 与 https://host/invite?code=...
export function parseInviteLink(rawInput: string): ParsedInviteLink | null {
  const raw = String(rawInput || '').trim()
  if (!raw) return null

  const embeddedCustom = raw.match(/sharegpt:\/\/invite\?[^\s"'<>]+/i)?.[0]
  const embeddedHttp = raw.match(/https?:\/\/[^\s"'<>]+/i)?.[0]
  const candidate = embeddedCustom || embeddedHttp || raw

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return null
  }

  if (parsed.protocol.toLowerCase() === 'sharegpt:') {
    const serverRaw = String(parsed.searchParams.get('server') || '').trim()
    const code = String(parsed.searchParams.get('code') || '').trim()
    if (!serverRaw || !code || !/^https?:\/\//i.test(serverRaw)) return null
    try {
      const serverParsed = new URL(serverRaw)
      if (!serverParsed.hostname) return null
    } catch {
      return null
    }
    return { serverUrl: serverRaw.replace(/\/+$/, ''), code }
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    let code = String(parsed.searchParams.get('code') || '').trim()
    if (!code && parsed.hash) {
      const hashText = parsed.hash.replace(/^#/, '')
      const hashParams = new URLSearchParams(hashText)
      code = String(hashParams.get('invite') || hashParams.get('code') || '').trim()
    }
    if (!code) return null
    const basePath = parsed.pathname.replace(/\/invite\/?$/i, '').replace(/\/+$/, '')
    return {
      serverUrl: `${parsed.origin}${basePath}`,
      code,
    }
  }

  return null
}
