// ShareGPT 设置数据结构 (对应 settings.json, 与旧版 100% 兼容)。

export interface SenderSettings {
  proxy_server: string
  proxy_port: string
  proxy_uuid: string
  socks_listen_port: string
  fallback_mode: string
  fallback_local_port: string
  target_domains: string
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
}

export interface AppSettings {
  sender: Partial<SenderSettings>
  receiver: Partial<ReceiverSettings>
  collab: Partial<CollabSettings>
  gpt: Record<string, unknown>
  gemini: Record<string, unknown>
  ui: Partial<UiSettings>
}

export type ServiceState = 'stopped' | 'starting' | 'running' | 'error'

export interface StatusPayload {
  sender?: ServiceState | string
  receiver?: ServiceState | string
  [k: string]: unknown
}
