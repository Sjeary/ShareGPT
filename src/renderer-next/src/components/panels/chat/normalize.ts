import type {
  ChatAttachment,
  ChatForwardedFrom,
  ChatMessage,
  ChatReplyTarget,
  ChatScope,
  DirectoryUser,
  ReadReceiptUser,
} from '@/store/useChatStore'

// 把任意服务器/本地 payload 规范成 ChatMessage。
// 移植自旧 renderer.js normalizeChatMessage(~3575) + 附属规范化函数。

function s(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function num(v: unknown): number {
  const n = Number.parseInt(String(v ?? ''), 10)
  return Number.isInteger(n) && n >= 0 ? n : 0
}

export function normalizeAttachments(items: unknown): ChatAttachment[] {
  if (!Array.isArray(items)) return []
  return items
    .map((raw): ChatAttachment | null => {
      const item = raw as Record<string, unknown>
      const dataUrl = s(item?.dataUrl)
      if (!dataUrl) return null
      return {
        kind: s(item?.kind) === 'image' ? 'image' : 'file',
        name: s(item?.name).slice(0, 200) || 'file',
        mime: s(item?.mime).slice(0, 200),
        size: num(item?.size),
        dataUrl,
      }
    })
    .filter((x): x is ChatAttachment => x !== null)
}

function normalizeReplyTarget(raw: unknown): ChatReplyTarget | null {
  const r = raw as Record<string, unknown> | null | undefined
  const id = s(r?.id)
  if (!id) return null
  return {
    id,
    from: s(r?.from ?? r?.username),
    displayName: s(r?.displayName ?? r?.username ?? r?.from) || '消息',
    preview: s(r?.preview).slice(0, 240) || '原消息',
    timestamp: s(r?.timestamp),
  }
}

// 群聊已读回执 (移植自旧 normalizeReadBy ~271): 去重 by username, 按 readAt 升序。
export function normalizeReadBy(items: unknown): ReadReceiptUser[] {
  if (!Array.isArray(items)) return []
  const seen = new Set<string>()
  const out: ReadReceiptUser[] = []
  for (const raw of items) {
    const item = raw as Record<string, unknown> | null | undefined
    const username = s(item?.username ?? item?.from)
    if (!username || seen.has(username)) continue
    seen.add(username)
    out.push({
      username,
      displayName: s(item?.displayName ?? item?.username ?? item?.from) || username,
      readAt: s(item?.readAt ?? item?.timestamp) || new Date().toISOString(),
    })
  }
  return out.sort((a, b) => a.readAt.localeCompare(b.readAt))
}

function normalizeForwardedFrom(raw: unknown): ChatForwardedFrom | null {
  const r = raw as Record<string, unknown> | null | undefined
  const from = s(r?.from ?? r?.username)
  if (!from) return null
  return {
    from,
    displayName: s(r?.displayName ?? r?.username ?? r?.from) || '转发消息',
  }
}

export function normalizeChatMessage(raw: unknown): ChatMessage {
  const p = (raw ?? {}) as Record<string, unknown>
  const scope: ChatScope = s(p.scope) === 'private' ? 'private' : 'subnet'
  const from = s(p.from ?? p.username)
  const username = s(p.username ?? p.from) || '系统通知'
  const displayName = s(p.displayName) || username
  const system = Boolean(p.system) || username === '系统通知'
  const recalled = Boolean(p.recalled)
  const edited = Boolean(p.edited)

  return {
    id: s(p.id),
    type: s(p.type) || (system ? 'system' : 'chat'),
    scope,
    from,
    to: s(p.to),
    username,
    displayName,
    avatar: s(p.avatar),
    text: s(p.text),
    attachments: normalizeAttachments(p.attachments),
    replyTo: normalizeReplyTarget(p.replyTo),
    forwardedFrom: normalizeForwardedFrom(p.forwardedFrom),
    timestamp: s(p.timestamp) || new Date().toISOString(),
    readAt: scope === 'private' ? s(p.readAt) : '',
    readBy: scope === 'subnet' ? normalizeReadBy(p.readBy) : [],
    edited,
    editedAt: edited ? s(p.editedAt) || new Date().toISOString() : '',
    subnetKey: s(p.subnetKey),
    subnetLabel: s(p.subnetLabel ?? p.roomScope),
    system,
    recalled,
    recalledAt: recalled ? s(p.recalledAt) || new Date().toISOString() : '',
    reactions:
      p.reactions && typeof p.reactions === 'object'
        ? (p.reactions as Record<string, string[]>)
        : {},
  }
}

export function normalizeDirectory(raw: unknown): DirectoryUser[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item): DirectoryUser => {
      const r = item as Record<string, unknown>
      const uname = s(r?.username)
      return {
        username: uname,
        displayName: s(r?.displayName) || uname,
        avatar: s(r?.avatar),
        online: Boolean(r?.online),
      }
    })
    .filter((x) => x.username)
}

export function hasMessageContent(m: ChatMessage): boolean {
  return Boolean(m.recalled || m.text || m.attachments.length)
}

// 从本地历史 payload (window.api.loadChatHistory) 提取并规范会话表。
// payload 结构: { version, conversations: { [key]: rawMessage[] } }
export function hydrateConversations(payload: unknown): Record<string, ChatMessage[]> {
  const out: Record<string, ChatMessage[]> = {}
  const conversations =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>).conversations
      : null
  if (!conversations || typeof conversations !== 'object') return out

  for (const [key, rawItems] of Object.entries(conversations as Record<string, unknown>)) {
    const k = s(key)
    if (!k || !Array.isArray(rawItems)) continue
    const items = rawItems.map((x) => normalizeChatMessage(x)).filter(hasMessageContent)
    if (items.length) out[k] = items.slice(-300)
  }
  return out
}

// 序列化回本地持久化格式 (window.api.saveChatHistory)。
export function serializeConversations(conversations: Record<string, ChatMessage[]>): {
  version: number
  conversations: Record<string, ChatMessage[]>
} {
  const out: Record<string, ChatMessage[]> = {}
  for (const [key, items] of Object.entries(conversations)) {
    if (items?.length) out[key] = items
  }
  return { version: 1, conversations: out }
}
