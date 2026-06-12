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

// 旧版固定走连接的网站默认值由 GPT/Gemini 允许域拼接而来; 新渲染层不持有该常量,
// 故 target_domains 为空时保持空字符串, 由主进程回填默认值 (旧逻辑 startSender 内已兜底)。
export const FALLBACK_MODES = [
  { value: 'system_proxy', label: '通过本机代理访问' },
  { value: 'direct', label: '直接访问' },
] as const
