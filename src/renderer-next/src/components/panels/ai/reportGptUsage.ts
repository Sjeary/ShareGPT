import { useAuthStore } from '@/store/useAuthStore'
import { useAppStore } from '@/store/useAppStore'

// 上报一次 GPT 提问 (对齐旧 renderer.js reportGptUsage)。
// 直连协作服务器 POST /api/gpt/usage, 带 Bearer token。
// 统计面板 (stats) 由另一面板负责展示, 这里只负责"计数上报"这一侧。
export async function reportGptUsage(): Promise<void> {
  const token = useAuthStore.getState().token
  const serverUrl = String(useAppStore.getState().settings?.collab?.server_url || '').trim()
  if (!serverUrl || !token) return

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(`${serverUrl}/api/gpt/usage`, {
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
      throw new Error(text || `记录 GPT 使用次数失败（${response.status}）`)
    }
  } finally {
    clearTimeout(timer)
  }
}

// 去重的查询登记 (对齐旧 registerGptQuery): 同一文本 1.8s 内只上报一次。
let lastTrackedText = ''
let lastTrackedAt = 0

export function registerGptQuery(text: string): void {
  const normalized = String(text || '').trim().slice(0, 160)
  if (!normalized) return

  const now = Date.now()
  if (normalized === lastTrackedText && now - lastTrackedAt < 1800) return

  lastTrackedText = normalized
  lastTrackedAt = now
  void reportGptUsage().catch(() => undefined)
}
