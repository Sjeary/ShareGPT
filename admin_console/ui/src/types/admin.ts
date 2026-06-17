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

export type AdminTab = 'overview' | 'users' | 'bootstrap' | 'releases' | 'extras'

// 401 等鉴权失效时抛出, store 据此自动登出回登录页。
export class AuthExpiredError extends Error {
  constructor(message = '登录已失效，请重新登录') {
    super(message)
    this.name = 'AuthExpiredError'
  }
}
