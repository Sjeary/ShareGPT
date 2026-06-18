import type { StatusPayload } from '@/types/settings'

// 主进程 backend.js 实际下发的状态字段 (StatusPayload 仅声明 sender/receiver,
// 这里通过 index signature 读取真实字段)。
export function isSenderRunning(status: StatusPayload): boolean {
  return Boolean(status.senderRunning)
}

export function isReceiverRunning(status: StatusPayload): boolean {
  return Boolean(status.receiverFrpcRunning || status.receiverSingboxRunning)
}

// 去除首尾空白, 安全转字符串 (对应旧版 safeText)。
export function safeText(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

// 纯数字端口校验。
export function isPortNumber(value: string): boolean {
  return /^\d+$/.test(value.trim())
}

// 旧版「固定走连接的网站」默认值由 GPT/Gemini 允许域拼接去重而来。
// 逐字对照旧 renderer.js 的 GPT_ALLOWED_HOSTS(~108) 与 GEMINI_ALLOWED_HOSTS(~118)。
const GPT_ALLOWED_HOSTS = [
  'chatgpt.com',
  'openai.com',
  'auth0.com',
  'oaistatic.com',
  'oaiusercontent.com',
  'gravatar.com',
  'cloudflare.com',
  'wp.com',
]
const GEMINI_ALLOWED_HOSTS = [
  'gemini.google.com',
  'google.com',
  'googleapis.com',
  'googleusercontent.com',
  'gstatic.com',
  'gvt1.com',
  'googletagmanager.com',
]
// Claude (claude.ai 网页) 走代理的域名。须与 src/main/backend.js 的 DEFAULT_TARGET_DOMAINS
// 中的 Claude 部分逐字一致, 这样「固定走连接的网站」展示值 = 实际路由的域名清单。
const CLAUDE_ALLOWED_HOSTS = [
  'claude.ai',
  'anthropic.com',
  'claudeusercontent.com',
  'claudemcpcontent.com',
  'sentry.io',
  'stripe.com',
  'hcaptcha.com',
  'doubleclick.net',
  'datadoghq.com',
  'browser-intake-us5-datadoghq.com',
  'facebook.net',
  'intercom.io',
  'intercomcdn.com',
  // Claude artifacts / 代码运行加载的 CDN (jsDelivr / esm.sh)。
  'jsdelivr.net',
  'esm.sh',
]

// 对应旧 renderer.js ~126 的 DEFAULT_TARGET_DOMAINS: 各组允许域去重后以逗号拼接。
// target_domains 缺省/导入为空时回填此默认串 (旧 getSenderForm ~2408 / fillForm ~2489
// / normalizeBootstrapPayload ~2750 / applySenderBootstrapConfig ~2790 行为一致)。
export const DEFAULT_TARGET_DOMAINS = [
  ...new Set([...GPT_ALLOWED_HOSTS, ...GEMINI_ALLOWED_HOSTS, ...CLAUDE_ALLOWED_HOSTS]),
].join(',')

export const FALLBACK_MODES = [
  { value: 'system_proxy', label: '通过本机代理访问' },
  { value: 'direct', label: '直接访问' },
] as const
