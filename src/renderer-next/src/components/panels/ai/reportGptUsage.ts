import { useAuthStore } from '@/store/useAuthStore'
import { useAppStore } from '@/store/useAppStore'
import {
  settingsPrincipalRuntime,
  StaleSettingsPrincipalError,
} from '@/lib/settingsPrincipalRuntime'
import type { AiKind } from '@/store/useAiStore'

// 上报一次 AI 提问。直连协作服务器 POST /api/{kind}/usage, 带 Bearer token。
// 统计面板 (stats) 由另一面板负责展示, 这里只负责"计数上报"这一侧。
// 服务端按 kind 分别累计 (gpt/gemini/claude); 老服务端仅有 /api/gpt/usage,
// 其它 kind 的端点 404 时静默忽略 (不影响使用)。
export async function reportAiUsage(kind: AiKind, usageId = ''): Promise<void> {
  const token = useAuthStore.getState().token
  const serverUrl = String(useAppStore.getState().settings?.collab?.server_url || '')
    .trim()
    .replace(/\/+$/, '')
  if (!serverUrl || !token) return
  const principal = (() => {
    try {
      return settingsPrincipalRuntime.snapshot()
    } catch {
      return null
    }
  })()
  if (!principal) return

  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    settingsPrincipalRuntime.assertCurrent(principal)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    let retryable = true
    try {
      const response = await fetch(`${serverUrl}/api/${kind}/usage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ count: 1, ...(usageId ? { usageId } : {}) }),
        signal: controller.signal,
      })
      settingsPrincipalRuntime.assertCurrent(principal)
      if (response.ok) return
      const text = await response.text().catch(() => '')
      const error = new Error(text || `记录 ${kind} 使用次数失败（${response.status}）`)
      if (response.status < 500) retryable = false
      lastError = error
      throw error
    } catch (error) {
      if (error instanceof StaleSettingsPrincipalError) return
      lastError = error
      if (!retryable || attempt === 2) throw error
    } finally {
      clearTimeout(timer)
    }
    await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)))
  }
  throw lastError
}

// 兼容旧名: 仅 GPT。
export async function reportGptUsage(): Promise<void> {
  return reportAiUsage('gpt')
}

// 主进程只在页面真正接受发送后下发一个不含 prompt 的随机 ID。
// renderer 再按 ID 防重；永远不读取、缓存或上报用户提问文本。
const acceptedUsageIds = new Map<string, number>()
const acceptedUsagePending = new Map<string, Promise<void>>()

export function registerAcceptedAiSend(kind: AiKind, usageId: string): void {
  const id = String(usageId || '').trim()
  if (!/^[a-z0-9-]{3,80}$/i.test(id)) return
  const now = Date.now()
  for (const [key, expiresAt] of acceptedUsageIds) {
    if (expiresAt <= now) acceptedUsageIds.delete(key)
  }
  let principalId = ''
  try {
    principalId = settingsPrincipalRuntime.snapshot().principalId
  } catch {
    return
  }
  const key = `${principalId}:${kind}:${id}`
  if (acceptedUsageIds.has(key) || acceptedUsagePending.has(key)) return
  const pending = reportAiUsage(kind, id)
    .then(() => {
      acceptedUsageIds.set(key, Date.now() + 60_000)
    })
    .catch(() => undefined)
    .finally(() => acceptedUsagePending.delete(key))
  acceptedUsagePending.set(key, pending)
}

// 上报"会用到但没走代理"的域名给管理员 (服务端聚合, 供维护内置清单)。best-effort, 失败忽略。
export async function reportMissingDomains(domains: string[]): Promise<void> {
  const list = Array.from(new Set(domains.map((d) => String(d || '').trim()).filter(Boolean)))
  if (!list.length) return
  const token = useAuthStore.getState().token
  const serverUrl = String(useAppStore.getState().settings?.collab?.server_url || '').trim()
  if (!serverUrl || !token) return
  const meta = useAppStore.getState().meta
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    await fetch(`${serverUrl.replace(/\/+$/, '')}/api/proxy/missing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        domains: list,
        version: String(meta.version ?? ''),
        platform: String(meta.platform ?? ''),
      }),
      signal: controller.signal,
    })
  } catch {
    /* 老服务端无此端点或网络失败: 忽略 */
  } finally {
    clearTimeout(timer)
  }
}
