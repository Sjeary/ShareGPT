import type { ChatMessage } from '@/store/useChatStore'

// 时间/预览/头像格式化助手 (移植自旧 renderer.js formatConversationTime ~834 / messagePreviewText ~384 / avatarMark ~713)。

export function formatConversationTime(ts: string): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  const sameYear = d.getFullYear() === now.getFullYear()
  return sameYear
    ? `${d.getMonth() + 1}/${d.getDate()}`
    : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

export function formatMessageTime(ts: string): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatDateLabel(ts: string): string {
  if (!ts) return '今天'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '今天'
  const now = new Date()
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime()
  const startOfTarget = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
  ).getTime()
  const diffDays = Math.round((startOfToday - startOfTarget) / 86400000)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  return d.toLocaleDateString([], {
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function isSameDay(a: string, b: string): boolean {
  if (!a || !b) return false
  const da = new Date(a)
  const db = new Date(b)
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

export function avatarMark(avatar: string, fallbackName: string): string {
  const a = (avatar || '').trim()
  if (a) return a
  const name = (fallbackName || '').trim()
  if (!name) return '?'
  return name[0].toUpperCase()
}

export function messagePreview(message: ChatMessage): string {
  if (message.recalled) return '[已撤回]'
  if (message.forwardedFrom && !message.text && !message.attachments.length) {
    return '[转发消息]'
  }
  if (message.text) return message.text
  if (message.attachments.some((a) => a.kind === 'image')) return '[图片]'
  if (message.attachments.length) return `[文件] ${message.attachments[0].name}`
  return '新消息'
}

export function formatBytes(value: number): string {
  const size = Math.max(0, Number(value) || 0)
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024)
    return `${(size / 1024).toFixed(size >= 10 * 1024 ? 0 : 1)} KB`
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`
}
