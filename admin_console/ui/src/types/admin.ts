// 服务端 /api/admin/* 返回的数据结构。

export interface AdminProfile {
  username: string
  displayName: string
  isAdmin?: boolean
  avatar?: string
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

export interface Bootstrap {
  sender: Partial<BootstrapSender>
  update: Partial<BootstrapUpdate>
  extra: Record<string, unknown>
}

export type AdminTab =
  | 'overview'
  | 'users'
  | 'bootstrap'
  | 'releases'
  | 'extras'
  | 'feedback'
  | 'proxy-missing'
  | 'airport'

// 机场节点 (从 Clash 节点转换成 sing-box outbound, 按群下发给客户端作可选代理)。
export interface Airport {
  name: string
  outbound: Record<string, unknown> | null
  updatedAt?: string
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
