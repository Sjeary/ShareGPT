import type { AiKind } from '@/store/useAiStore'

// 对应旧 renderer.js 顶部常量与 *Url 工具函数。主进程已做兜底校验,
// 渲染层这里只用于规范化 / 选择默认主页, 与旧逻辑保持一致。

export const GPT_PROXY_HOST = '127.0.0.1'
export const GPT_PROXY_PORT = '1080'

export const GPT_HOME_URL = 'https://chatgpt.com/auth/login'
export const GEMINI_HOME_URL = 'https://gemini.google.com/'
export const CLAUDE_HOME_URL = 'https://claude.ai/'

export const GPT_PARTITION = 'persist:gpt-chat'
export const GEMINI_PARTITION = 'persist:gemini-chat'
export const CLAUDE_PARTITION = 'persist:claude-chat'

export const GPT_QUERY_MARKER = '__GPT_QUERY__'

// 旧 renderer.js GPT_ALLOWED_HOSTS / GEMINI_ALLOWED_HOSTS。
export const GPT_ALLOWED_HOSTS = [
  'chatgpt.com',
  'openai.com',
  'oaistatic.com',
  'oaiusercontent.com',
  'auth0.com',
  'auth.openai.com',
  'cloudflare.com',
  'challenges.cloudflare.com',
]

export const GEMINI_ALLOWED_HOSTS = [
  'gemini.google.com',
  'accounts.google.com',
  'google.com',
  'googleapis.com',
  'googleusercontent.com',
  'gstatic.com',
  'gvt1.com',
]

export const CLAUDE_ALLOWED_HOSTS = [
  'claude.ai',
  'anthropic.com',
  'claudeusercontent.com',
  'claudemcpcontent.com',
  'cloudflare.com',
  'challenges.cloudflare.com',
  'accounts.google.com',
  'google.com',
  'googleapis.com',
  'gstatic.com',
  'googleusercontent.com',
  'sentry.io',
  'stripe.com',
  'hcaptcha.com',
  'doubleclick.net',
  'datadoghq.com',
  'browser-intake-us5-datadoghq.com',
  'facebook.net',
  'intercom.io',
  'intercomcdn.com',
]

export function isAllowedUrlForHosts(rawUrl: string, allowedHosts: string[]): boolean {
  try {
    const url = new URL(String(rawUrl || ''))
    if (!/^https?:$/i.test(url.protocol)) return false
    return allowedHosts.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    )
  } catch {
    return false
  }
}

export function isGptAllowedUrl(rawUrl: string): boolean {
  return isAllowedUrlForHosts(rawUrl, GPT_ALLOWED_HOSTS)
}

export function isGeminiAllowedUrl(rawUrl: string): boolean {
  return isAllowedUrlForHosts(rawUrl, GEMINI_ALLOWED_HOSTS)
}

export function isClaudeAllowedUrl(rawUrl: string): boolean {
  return isAllowedUrlForHosts(rawUrl, CLAUDE_ALLOWED_HOSTS)
}

// 旧 normalizeGptUrl: chatgpt.com 根路径回落到登录主页, 非法 URL 回落主页。
export function normalizeGptUrl(rawUrl: string, homeUrl = GPT_HOME_URL): string {
  const url = String(rawUrl || '').trim()
  if (url && isGptAllowedUrl(url)) {
    try {
      const parsed = new URL(url)
      if (parsed.hostname === 'chatgpt.com' && parsed.pathname === '/' && !parsed.search) {
        return homeUrl
      }
    } catch {
      /* ignore */
    }
    return url
  }
  return homeUrl
}

export function normalizeGeminiUrl(rawUrl: string, homeUrl = GEMINI_HOME_URL): string {
  const url = String(rawUrl || '').trim()
  if (url && isGeminiAllowedUrl(url)) return url
  return homeUrl
}

export function normalizeClaudeUrl(rawUrl: string, homeUrl = CLAUDE_HOME_URL): string {
  const url = String(rawUrl || '').trim()
  if (url && isClaudeAllowedUrl(url)) return url
  return homeUrl
}

export function homeUrlFor(kind: AiKind): string {
  return kind === 'gpt' ? GPT_HOME_URL : kind === 'claude' ? CLAUDE_HOME_URL : GEMINI_HOME_URL
}

export function partitionFor(kind: AiKind): string {
  return kind === 'gpt' ? GPT_PARTITION : kind === 'claude' ? CLAUDE_PARTITION : GEMINI_PARTITION
}

// 旧 gptUserAgent: 仅去掉 Electron/ShareGPT/ChatPortal 标识, 伪装成普通 Chrome。
// 注意: 不要改写 Chrome 版本号! UA 字符串的版本一旦与引擎真实的 Sec-CH-UA / navigator.userAgentData
// 不一致, Cloudflare Turnstile(Claude 用的就是它)会判为"浏览器特征不一致"而拒绝验证, 导致一直卡在
// 验证页(ChatGPT 的验证较宽松, 故只有 Claude 受影响)。保持 UA 与引擎一致是 Turnstile 通过的关键。
export function embeddedUserAgent(): string {
  if (typeof navigator === 'undefined') return ''
  return String(navigator.userAgent || '')
    .replace(/\s*Electron\/[^\s]+/gi, '')
    .replace(/\s*ShareGPT\/[^\s]+/gi, '')
    .replace(/\s*ChatPortal(?:\s+X1)?(?:\s+V\d+)?\/[^\s]+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
