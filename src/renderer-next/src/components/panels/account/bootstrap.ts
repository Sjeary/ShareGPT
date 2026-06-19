// 账户域: 客户端 bootstrap 配置 + 版本比较工具。
// 移植自旧 renderer.js compareVersions(~212) / normalizeBootstrapPayload(~2736)
// / hasCompleteSenderBootstrap(~2762) / currentUpdatePlatformKey(~225)。
//
// 端点: GET {server}/api/client/bootstrap (Bearer token) -> { sender, update }
//   - sender: 服务器下发的发送端默认配置 (本机 sender 不完整时用来补全)
//   - update: 当前服务器发布的最新版本信息 (供"应用内更新"UI 读取)

import { api } from '@/lib/api'
import { DEFAULT_TARGET_DOMAINS } from '@/components/panels/service/helpers'

// 与旧 safeText 对齐: 仅接受字符串/数字, 其余视为空串并去首尾空白。
function safeText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

export interface BootstrapSender {
  proxy_server: string
  proxy_port: string
  proxy_uuid: string
  socks_listen_port: string
  fallback_mode: string
  fallback_local_port: string
  target_domains: string
}

export interface BootstrapUpdate {
  version: string
  notes: string
  publishedAt: string
  url: string
  fileName: string
  htmlUrl?: string
}

// 自动更新源 = GitHub Releases (参考 cc-switch)。由主进程 (app:update-check) 查询
// 当前平台的最新安装包, 完全不经过任何自建服务器; 目标仓库由 package.json 决定。
// 任意失败 (无网络 / GitHub 不可达 / 无 release) 都安静返回 null。
export async function checkGithubUpdate(): Promise<BootstrapUpdate | null> {
  try {
    const raw = (await api.checkAppUpdate()) as Record<string, unknown> | null
    if (!raw || typeof raw !== 'object') return null
    const version = safeText(raw.version)
    if (!version) return null
    return {
      version,
      notes: safeText(raw.notes),
      publishedAt: safeText(raw.publishedAt),
      url: safeText(raw.url),
      fileName: safeText(raw.fileName),
      htmlUrl: safeText(raw.htmlUrl),
    }
  } catch {
    return null
  }
}

// 服务器下发的机场节点 (管理端从 Clash 节点转换成 sing-box outbound)。
export interface BootstrapAirport {
  name: string
  outbound: Record<string, unknown> | null
}

export interface BootstrapPayload {
  sender: BootstrapSender
  update: BootstrapUpdate
  airport: BootstrapAirport | null
}

// 旧 currentUpdatePlatformKey(~225): darwin -> macos, 其余 -> windows。
function currentUpdatePlatformKey(): 'macos' | 'windows' {
  return api.platform === 'darwin' ? 'macos' : 'windows'
}

// 旧 normalizeBootstrapPayload(~2736): 规整 sender + 当前平台的 update 包信息。
export function normalizeBootstrapPayload(raw: unknown): BootstrapPayload {
  const payload = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const sender =
    payload.sender && typeof payload.sender === 'object'
      ? (payload.sender as Record<string, unknown>)
      : {}
  const update =
    payload.update && typeof payload.update === 'object'
      ? (payload.update as Record<string, unknown>)
      : {}
  const platformRaw = update[currentUpdatePlatformKey()]
  const platformUpdate =
    platformRaw && typeof platformRaw === 'object' ? (platformRaw as Record<string, unknown>) : {}

  const airportRaw =
    payload.airport && typeof payload.airport === 'object'
      ? (payload.airport as Record<string, unknown>)
      : null
  const airportOutbound =
    airportRaw && airportRaw.outbound && typeof airportRaw.outbound === 'object'
      ? (airportRaw.outbound as Record<string, unknown>)
      : null

  return {
    airport: airportOutbound
      ? { name: safeText(airportRaw?.name), outbound: airportOutbound }
      : null,
    sender: {
      proxy_server: safeText(sender.proxy_server),
      proxy_port: safeText(sender.proxy_port),
      proxy_uuid: safeText(sender.proxy_uuid),
      socks_listen_port: safeText(sender.socks_listen_port),
      fallback_mode: safeText(sender.fallback_mode) || 'system_proxy',
      fallback_local_port: safeText(sender.fallback_local_port),
      target_domains: safeText(sender.target_domains) || DEFAULT_TARGET_DOMAINS,
    },
    update: {
      version: safeText(update.version),
      notes: safeText(update.notes),
      publishedAt: safeText(update.publishedAt),
      url: safeText(platformUpdate.url),
      fileName: safeText(platformUpdate.fileName),
    },
  }
}

// 旧 hasCompleteSenderBootstrap(~2762): proxy_server/port/uuid 三者齐全才算"已配置发送端"。
export function hasCompleteSenderBootstrap(
  sender: Partial<BootstrapSender> | undefined | null,
): boolean {
  return Boolean(
    safeText(sender?.proxy_server) && safeText(sender?.proxy_port) && safeText(sender?.proxy_uuid),
  )
}

// 旧 compareVersions(~212): 逐段比较点分版本号, 返回 1 / -1 / 0。
export function compareVersions(left: string, right: string): number {
  const leftParts = String(left || '')
    .split('.')
    .map((item) => Number.parseInt(item, 10) || 0)
  const rightParts = String(right || '')
    .split('.')
    .map((item) => Number.parseInt(item, 10) || 0)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const a = leftParts[index] || 0
    const b = rightParts[index] || 0
    if (a > b) return 1
    if (a < b) return -1
  }
  return 0
}
