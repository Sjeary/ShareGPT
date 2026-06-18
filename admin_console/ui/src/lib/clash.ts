import yaml from 'js-yaml'

// Clash 订阅 -> 节点列表 -> sing-box outbound 转换。
// 支持常见协议: shadowsocks(ss) / vmess / trojan / vless, 含 ws / tls 传输。其余返回 null。

export interface ClashNode {
  name: string
  type: string
  server: string
  port: number
  supported: boolean
  raw: Record<string, unknown>
}

export const SUPPORTED_TYPES = ['ss', 'shadowsocks', 'vmess', 'trojan', 'vless']

export function parseClashProxies(text: string): ClashNode[] {
  let doc: unknown
  try {
    doc = yaml.load(text)
  } catch {
    return []
  }
  const proxies = (doc as Record<string, unknown> | null)?.proxies
  if (!Array.isArray(proxies)) return []
  return proxies
    .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === 'object')
    .map((p) => {
      const type = String(p.type ?? '').toLowerCase()
      return {
        name: String(p.name ?? ''),
        type,
        server: String(p.server ?? ''),
        port: Number(p.port) || 0,
        supported: SUPPORTED_TYPES.includes(type),
        raw: p,
      }
    })
    .filter((n) => n.name && n.server && n.port)
}

const num = (v: unknown, d = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}
const bool = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1'
const str = (v: unknown) => (v == null ? '' : String(v))

export function clashNodeToSingbox(node: ClashNode): Record<string, unknown> | null {
  const p = node.raw
  const type = node.type
  const server = str(p.server)
  const server_port = num(p.port)
  if (!server || !server_port) return null

  // ws 传输 (通用)。
  const network = str(p.network).toLowerCase()
  const wsOpts = (p['ws-opts'] && typeof p['ws-opts'] === 'object' ? p['ws-opts'] : {}) as Record<
    string,
    unknown
  >
  const wsPath = str(wsOpts.path || p['ws-path']) || '/'
  const wsHeaders =
    wsOpts.headers && typeof wsOpts.headers === 'object'
      ? (wsOpts.headers as Record<string, unknown>)
      : undefined
  const transport =
    network === 'ws'
      ? { type: 'ws', path: wsPath, ...(wsHeaders ? { headers: wsHeaders } : {}) }
      : undefined

  const tlsEnabled = bool(p.tls)
  const sni = str(p.sni || p.servername || p['server-name']) || server
  const tls = tlsEnabled
    ? { enabled: true, server_name: sni, insecure: bool(p['skip-cert-verify']) }
    : undefined

  if (type === 'ss' || type === 'shadowsocks') {
    return {
      type: 'shadowsocks',
      server,
      server_port,
      method: str(p.cipher),
      password: str(p.password),
    }
  }
  if (type === 'vmess') {
    const o: Record<string, unknown> = {
      type: 'vmess',
      server,
      server_port,
      uuid: str(p.uuid),
      alter_id: num(p.alterId ?? p.aid ?? 0),
      security: str(p.cipher) || 'auto',
    }
    if (transport) o.transport = transport
    if (tls) o.tls = tls
    return o
  }
  if (type === 'trojan') {
    const o: Record<string, unknown> = {
      type: 'trojan',
      server,
      server_port,
      password: str(p.password),
      tls: { enabled: true, server_name: sni, insecure: bool(p['skip-cert-verify']) },
    }
    if (transport) o.transport = transport
    return o
  }
  if (type === 'vless') {
    const o: Record<string, unknown> = {
      type: 'vless',
      server,
      server_port,
      uuid: str(p.uuid),
    }
    if (str(p.flow)) o.flow = str(p.flow)
    if (transport) o.transport = transport
    if (tls) o.tls = tls
    return o
  }
  return null
}
