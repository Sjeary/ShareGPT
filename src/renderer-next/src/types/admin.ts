// 服务端 /api/admin/* 返回的数据结构。

export interface AdminProfile {
  username: string
  displayName: string
  isAdmin?: boolean
  avatar?: string
}

// In-memory desktop session. Never persist this object or its token.
export interface IntegratedAdminSession {
  serverUrl: string
  token: string
  username: string
  isAdmin: boolean
}

export interface CreateUserInput {
  username: string
  password: string
  displayName?: string
  avatar?: string
  bio?: string
  isAdmin?: boolean
  advancedAiAllowed?: boolean
  allowedProxyRouteIds?: string[]
  chatDisabled?: boolean
}

export type UpdateUserInput = Partial<Omit<CreateUserInput, 'username'>> & { disabled?: boolean }
export interface CreateInviteInput {
  note?: string
  maxUses?: number | null
  expiresInHours?: number | null
  chatDisabled?: boolean
  allowedProxyRouteIds?: string[]
}
export interface AiUsageFilters {
  service?: AiServiceKind
  from?: string
  to?: string
}
export interface TranslationUsageFilters {
  from?: string
  to?: string
  username?: string
  profileId?: string
}
export interface AdminAirport {
  name: string
  outbound: Record<string, unknown> | null
  updatedAt?: string
}
export interface AdminOverview {
  total: number
  online: number
  admins: number
  disabled: number
  advancedAi: number
}
export type AdminExtras = Bootstrap['extra']
// The existing admin release page reads the effective bootstrap update, not a release history.
export type AdminReleases = Partial<BootstrapUpdate>
export interface ReleaseUploadInput {
  platform: 'windows' | 'macos'
  fileName: string
  file: Blob
  version?: string
  notes?: string
}

export interface AdminClientInfo {
  version?: string
  platform?: string
  arch?: string
  mode?: string
  reportedAt?: string
}

export interface AdminUser {
  username: string
  displayName: string
  avatar?: string
  bio?: string
  isAdmin: boolean
  advancedAiAllowed: boolean
  allowedProxyRouteIds: string[]
  disabled: boolean
  // 禁止使用协作聊天: 该用户无聊天入口、不收消息、别人发他也不弹窗。
  chatDisabled?: boolean
  online: boolean
  client?: AdminClientInfo
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

export interface BootstrapReleaseAsset {
  url: string
  fileName: string
}

export interface BootstrapUpdate {
  version: string
  notes: string
  publishedAt: string
  windows: BootstrapReleaseAsset
  macos: BootstrapReleaseAsset
}

export interface BootstrapAiRouting {
  version: 1
  defaultRouteByKind: Record<'gpt' | 'gemini' | 'claude', string>
  updatedAt: string
}

export interface Bootstrap {
  sender: Partial<BootstrapSender>
  update: Partial<BootstrapUpdate>
  aiRouting: BootstrapAiRouting
  extra: Record<string, unknown>
}

export type AdminTab =
  | 'overview'
  | 'ai-usage'
  | 'users'
  | 'invites'
  | 'bootstrap'
  | 'releases'
  | 'extras'
  | 'feedback'
  | 'proxy-missing'
  | 'airport'
  | 'translation'

export type AdminInviteStatus = 'active' | 'expired' | 'exhausted' | 'revoked'

export interface AdminInviteRegistration {
  username: string
  registeredAt: string
}

export interface AdminInvite {
  id: string
  code: string
  note: string
  createdBy: string
  createdAt: string
  expiresAt: string
  maxUses: number | null
  usedCount: number
  remainingUses: number | null
  revokedAt: string
  chatDisabled: boolean
  allowedProxyRouteIds: string[]
  registrations: AdminInviteRegistration[]
  status: AdminInviteStatus
}

export interface ProxyRoute {
  id: string
  name: string
  enabled: boolean
  outbound: Record<string, unknown>
  expected: {
    ip: string
    countryCode: string
    asn: string
  }
  updatedAt?: string
}

export interface ProxyRouteCatalog {
  version: 1
  routes: ProxyRoute[]
  updatedAt?: string
}

export interface ProxyRouteHealth {
  username: string
  routeId: string
  ok: boolean
  ip: string
  countryCode: string
  asn: string
  checks: Record<string, boolean>
  checkedAt: string
}

export interface TranslationPricing {
  currency: string
  inputPerMillion: number
  outputPerMillion: number
  perRequest: number
}

export interface AdminTranslationProfile {
  id: string
  name: string
  type: 'ai' | 'api'
  baseUrl: string
  model: string
  effort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  enabled: boolean
  accessMode: 'all' | 'restricted'
  allowedUsernames: string[]
  pricing: TranslationPricing
  apiKeyConfigured: boolean
  apiKeyHint: string
  usesPlainHttp: boolean
  updatedAt?: string
  apiKey?: string
  clearApiKey?: boolean
}

export interface TranslationProfileCatalog {
  version: 1
  defaultProfileId: string
  encryptionReady: boolean
  profiles: AdminTranslationProfile[]
  updatedAt?: string
}

export interface TranslationUsageTotals {
  requests: number
  inputChars: number
  outputChars: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costByCurrency: Record<string, number>
}

export interface TranslationUsageReport {
  totals: TranslationUsageTotals
  byProfile: Array<{
    profileId: string
    profileName: string
    requests: number
    totalTokens: number
    costByCurrency: Record<string, number>
  }>
  byUser: Array<{
    username: string
    requests: number
    totalTokens: number
    costByCurrency: Record<string, number>
  }>
  recent: Array<{
    id: string
    username: string
    profileId: string
    profileName: string
    timestamp: string
    inputChars: number
    outputChars: number
    inputTokens: number
    outputTokens: number
    totalTokens: number
    costMicros: number
    currency: string
  }>
}

export type AiServiceKind = 'gpt' | 'gemini' | 'claude'

export interface AiUsageUser {
  username: string
  displayName: string
  count: number
  ratio: number
}

export interface AiUsageReport {
  service: AiServiceKind
  from: string
  to: string
  totalQueries: number
  userCount: number
  users: AiUsageUser[]
  serverTime: string
}

// 客户端上报的"会用到但没走代理"的域名 (聚合)。供维护内置代理清单。
export interface ProxyMissingItem {
  host: string
  count: number
  firstSeen: string
  lastSeen: string
  reporters: string[]
  versions: string[]
}

// 用户反馈建议 (客户端 POST /api/feedback 提交, 管理端 GET /api/admin/feedback 查看)。
export interface FeedbackItem {
  id: string
  username: string
  displayName: string
  text: string
  version: string
  platform: string
  createdAt: string
}

// 全局发布 (开发者维度, 共享发布库)。
export interface SharedReleaseAsset {
  fileName: string
}
export interface SharedRelease {
  version: string
  notes: string
  publishedAt: string
  windows: SharedReleaseAsset
  macos: SharedReleaseAsset
}

// 401 等鉴权失效时抛出, store 据此自动登出回登录页。
export class AuthExpiredError extends Error {
  constructor(message = '登录已失效，请重新登录') {
    super(message)
    this.name = 'AuthExpiredError'
  }
}
