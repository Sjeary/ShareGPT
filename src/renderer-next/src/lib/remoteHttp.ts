const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])

export const REMOTE_HTTP_WARNING =
  '当前远程地址使用 HTTP。内容和接口密钥会以明文在网络中传输；应用仍允许保存并使用该地址。'

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
}

export function usesRemoteHttp(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl.trim())
    return url.protocol === 'http:' && !LOOPBACK_HOSTNAMES.has(normalizeHostname(url.hostname))
  } catch {
    return false
  }
}
