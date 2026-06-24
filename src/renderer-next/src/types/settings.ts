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
  // 代理出站方式 (可选, 默认 unified): unified = 统一 VMess 梯子; airport = 服务器下发的机场节点。
  proxy_mode?: 'unified' | 'airport'
  // 机场节点 (sing-box outbound, 由管理端从 Clash 节点转换后经 bootstrap 下发)。
  airport_outbound?: Record<string, unknown> | null
  // 机场节点展示名 (供 UI 显示当前用的是哪个节点)。
  airport_name?: string
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
  // 被隐藏的内容导航入口 (ChatGPT/日历/待办/笔记/专注 等的 NavKey)。
  hiddenNav?: string[]
  // 用户自定义的导航排序 (NavKey 数组)。缺失的 key 按 NAV 默认顺序补在末尾。
  navOrder?: string[]
  // 登录页「发现新版本」提醒中点了「不再提示」的版本号集合 (按版本记忆)。
  dismissed_update_versions: string[]
  // 上次运行的 app 版本; 版本变化时用于刷新代理自动域名 (剔除已并入内置清单的项)。
  last_version: string
  // 「机场节点不稳定」提醒是否已点「不再提示」。
  airport_notice_dismissed: boolean
  // 「不用 Claude 就别打开」提醒是否已关闭。
  claude_notice_dismissed: boolean
  // 新手引导(分步高亮导览)是否已完成/跳过过一次; 已完成则不再自动弹, 仅可手动重看。
  onboarding_done: boolean
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
