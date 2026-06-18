// ShareGPT 设置数据结构 (对应 settings.json, 与旧版 100% 兼容)。

export interface SenderSettings {
  proxy_server: string
  proxy_port: string
  proxy_uuid: string
  socks_listen_port: string
  fallback_mode: string
  fallback_local_port: string
  target_domains: string
  // 测试用「全部流量走代理」(仅管理员可开): 除私有 IP 外所有流量都走梯子, 用于抓取实际访问的域名。
  route_all?: boolean
  // 本机自动加入的额外代理域名: 代理检测发现"会用到但没走代理"的域名时自动累积到这里,
  // 与内置 DEFAULT_TARGET_DOMAINS 合并参与路由。版本更新后会剔除已并入内置清单的项。
  auto_domains?: string[]
}

export interface ReceiverSettings {
  frps_server: string
  frps_port: string
  frps_token: string
  remote_port: string
  vmess_listen_port: string
  vmess_uuid: string
  forward_proxy_port: string
  tls_enable: boolean
  use_compression: boolean
  use_encryption: boolean
}

export interface CollabSettings {
  server_url: string
  last_username: string
  last_avatar: string
  remember_password: boolean
  saved_password: string
  notify_message_popup: boolean
  notify_system_notification: boolean
  notify_sound_play: boolean
  notify_user_online: boolean
  pinned_users: string[]
}

export interface UiSettings {
  setup_guide_dismissed: boolean
  theme: 'dark' | 'light'
  sidebarSide: 'left' | 'right'
  showGemini: boolean
  showClaude: boolean
  // 登录页「发现新版本」提醒中点了「不再提示」的版本号集合 (按版本记忆)。
  dismissed_update_versions: string[]
  // 上次运行的 app 版本; 版本变化时用于刷新代理自动域名 (剔除已并入内置清单的项)。
  last_version: string
}

export interface AppSettings {
  sender: Partial<SenderSettings>
  receiver: Partial<ReceiverSettings>
  collab: Partial<CollabSettings>
  gpt: Record<string, unknown>
  gemini: Record<string, unknown>
  claude: Record<string, unknown>
  ui: Partial<UiSettings>
}

export type ServiceState = 'stopped' | 'starting' | 'running' | 'error'

export interface StatusPayload {
  sender?: ServiceState | string
  receiver?: ServiceState | string
  [k: string]: unknown
}
