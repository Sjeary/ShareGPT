import { useAuthStore } from '@/store/useAuthStore'
import { useAppStore } from '@/store/useAppStore'
import type { AiKind } from '@/store/useAiStore'

// 上报一次 AI 提问。直连协作服务器 POST /api/{kind}/usage, 带 Bearer token。
// 统计面板 (stats) 由另一面板负责展示, 这里只负责"计数上报"这一侧。
// 服务端按 kind 分别累计 (gpt/gemini/claude); 老服务端仅有 /api/gpt/usage,
// 其它 kind 的端点 404 时静默忽略 (不影响使用)。
export async function reportAiUsage(kind: AiKind): Promise<void> {
  const token = useAuthStore.getState().token
  const serverUrl = String(useAppStore.getState().settings?.collab?.server_url || '').trim()
  if (!serverUrl || !token) return

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(`${serverUrl}/api/${kind}/usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ count: 1 }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(text || `记录 ${kind} 使用次数失败（${response.status}）`)
    }
  } finally {
    clearTimeout(timer)
  }
}

// 兼容旧名: 仅 GPT。
export async function reportGptUsage(): Promise<void> {
  return reportAiUsage('gpt')
}

// 去重的查询登记 (对齐旧 registerGptQuery): 同一 kind 的同一文本 1.8s 内只上报一次。
const lastTrackedText: Record<AiKind, string> = { gpt: '', gemini: '', claude: '' }
const lastTrackedAt: Record<AiKind, number> = { gpt: 0, gemini: 0, claude: 0 }

export function registerAiQuery(kind: AiKind, text: string): void {
  const normalized = String(text || '').trim().slice(0, 160)
  if (!normalized) return

  const now = Date.now()
  if (normalized === lastTrackedText[kind] && now - lastTrackedAt[kind] < 1800) return

  lastTrackedText[kind] = normalized
  lastTrackedAt[kind] = now
  void reportAiUsage(kind).catch(() => undefined)
}

// 兼容旧名: 仅 GPT。
export function registerGptQuery(text: string): void {
  registerAiQuery('gpt', text)
}
