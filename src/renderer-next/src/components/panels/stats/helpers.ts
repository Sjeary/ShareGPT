// 使用统计数据层: 直连协作服务器 GET /api/gpt/stats (总览 + 区间)。
// 逻辑对照旧版 renderer.js loadGptSummaryStats / loadGptRangeStats / setGptStatsPreset /
// formatGptStatsRangeText / renderGptStats。

export type StatsPreset = '7d' | '30d' | '90d' | 'all' | 'custom'

// 统计的 AI 维度 (与 /api/{kind}/stats 对应)。
export type StatsKind = 'gpt' | 'gemini' | 'claude'

export const STATS_KIND_LABELS: Record<StatsKind, string> = {
  gpt: 'ChatGPT',
  gemini: 'Gemini',
  claude: 'Claude',
}

// 排行条目 (对应旧版 state.gpt.statsEntries)。
export interface StatsEntry {
  username: string
  displayName: string
  count: number
  ratio: number
}

// 区间统计结果 (对应 /api/gpt/stats?from&to 响应)。
export interface RangeStats {
  totalQueries: number
  userCount: number
  entries: StatsEntry[]
}

// 时间区间 (ISO yyyy-mm-dd, 空串表示不限)。
export interface StatsRange {
  preset: StatsPreset
  from: string
  to: string
}

// 饼图调色板 (旧版 renderGptStats colors, 琥珀为第二主色)。
export const PIE_COLORS = [
  '#f59e0b',
  '#0a84ff',
  '#fb7185',
  '#22c55e',
  '#a855f7',
  '#14b8a6',
  '#f97316',
  '#eab308',
] as const

function safeText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function toNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

// 旧版 formatDateInputValue: 用 UTC 年月日生成 yyyy-mm-dd。
function formatDateInputValue(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const DAYS_MAP: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 }

// 旧版 setGptStatsPreset: 根据预设算出 from/to。
export function rangeFromPreset(preset: StatsPreset): StatsRange {
  const now = new Date()
  const today = formatDateInputValue(now)

  if (preset === 'all') {
    return { preset: 'all', from: '', to: '' }
  }
  if (preset === 'custom') {
    return { preset: 'custom', from: '', to: today }
  }

  const days = DAYS_MAP[preset] ?? 30
  const start = new Date(now)
  start.setUTCDate(start.getUTCDate() - (days - 1))

  return {
    preset: preset in DAYS_MAP ? preset : '30d',
    from: formatDateInputValue(start),
    to: today,
  }
}

// 从持久化 settings.gpt 读回区间 (对应旧版 applySettings stats_preset 分支)。
export function rangeFromSettings(gpt: Record<string, unknown> | undefined): StatsRange {
  const preset = safeText(gpt?.['stats_preset'])
  if (preset === 'custom') {
    return {
      preset: 'custom',
      from: safeText(gpt?.['stats_from']),
      to: safeText(gpt?.['stats_to']),
    }
  }
  if (preset === 'all') {
    return rangeFromPreset('all')
  }
  return rangeFromPreset((preset || '30d') as StatsPreset)
}

// 旧版 formatGptStatsRangeText。
export function formatRangeText(range: StatsRange): string {
  const { from, to } = range
  if (!from && !to) return '统计范围：全部时间'
  if (from && to) return `统计范围：${from} 至 ${to}`
  if (from) return `统计范围：${from} 之后`
  return `统计范围：截至 ${to}`
}

// 旧版 fetchWithFriendlyError: 超时 + 友好的连接错误提示。
async function fetchWithFriendlyError(
  url: string,
  options: RequestInit = {},
  timeoutMs = 8000,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    const e = err as { name?: string; message?: string }
    if (e?.name === 'AbortError') {
      throw new Error(`连接超时：${url}`)
    }
    const message = String(e?.message || err || '')
    if (/failed to fetch/i.test(message)) {
      throw new Error(
        `无法连接到服务地址：${url}。请确认服务已经启动，地址和端口填写正确，并且网络可以访问。`,
      )
    }
    throw err instanceof Error ? err : new Error(message || '请求失败')
  } finally {
    clearTimeout(timer)
  }
}

function normalizeBase(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, '')
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` }
}

// 旧版 loadGptRangeStats: 拉取指定区间排行。空 token/serverUrl 直接返回空。
export async function fetchRangeStats(
  serverUrl: string,
  token: string,
  range: StatsRange,
  kind: StatsKind = 'gpt',
): Promise<RangeStats> {
  if (!serverUrl || !token) {
    return { totalQueries: 0, userCount: 0, entries: [] }
  }

  const params = new URLSearchParams()
  if (range.from) params.set('from', range.from)
  if (range.to) params.set('to', range.to)
  const query = params.toString()
  const url = `${normalizeBase(serverUrl)}/api/${kind}/stats${query ? `?${query}` : ''}`

  const response = await fetchWithFriendlyError(url, {
    method: 'GET',
    headers: authHeaders(token),
  })

  // 老服务端没有 gemini/claude 的统计端点 → 视为暂无数据 (返回空), 不报错。
  if (response.status === 404) {
    return { totalQueries: 0, userCount: 0, entries: [] }
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `查询使用统计失败（${response.status}）`)
  }

  const payload = (await response.json()) as {
    totalQueries?: unknown
    userCount?: unknown
    users?: Array<Record<string, unknown>>
  }

  const entries: StatsEntry[] = (payload.users || [])
    .map((item) => ({
      username: safeText(item?.['username']),
      displayName: safeText(item?.['displayName']),
      count: toNumber(item?.['count']),
      ratio: toNumber(item?.['ratio']),
    }))
    .filter((item) => item.username && item.count > 0)
    .sort((a, b) => b.count - a.count || a.username.localeCompare(b.username))

  return {
    totalQueries: toNumber(payload.totalQueries),
    userCount: toNumber(payload.userCount) || entries.length,
    entries,
  }
}

// 饼图分段 (起止角度), 用于内联 conic-gradient。
export interface PieSegment {
  color: string
  startDeg: number
  endDeg: number
}

export function buildPieSegments(entries: StatsEntry[], total: number): PieSegment[] {
  if (!entries.length || total <= 0) return []
  let start = 0
  return entries.map((item, index) => {
    const slice = (item.count / total) * 360
    const end = start + slice
    const seg: PieSegment = {
      color: PIE_COLORS[index % PIE_COLORS.length],
      startDeg: start,
      endDeg: end,
    }
    start = end
    return seg
  })
}

export function conicGradient(segments: PieSegment[]): string {
  if (!segments.length) {
    return 'conic-gradient(rgba(148, 163, 184, 0.18) 0deg 360deg)'
  }
  const stops = segments.map(
    (s) => `${s.color} ${s.startDeg.toFixed(2)}deg ${s.endDeg.toFixed(2)}deg`,
  )
  return `conic-gradient(${stops.join(', ')})`
}

export function percentOf(count: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((count / total) * 100)
}

// 展示名 (旧版逻辑: displayName 与 username 不同则带括号)。
export function entryLabel(entry: StatsEntry): string {
  if (entry.displayName && entry.displayName !== entry.username) {
    return `${entry.displayName} (${entry.username})`
  }
  return entry.displayName || entry.username
}
