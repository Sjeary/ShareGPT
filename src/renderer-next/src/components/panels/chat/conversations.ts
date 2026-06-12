import {
  isRoomKey,
  privateConversationKey,
  roomConversationKey,
  usernameFromKey,
  type ChatMessage,
  type DirectoryUser,
} from '@/store/useChatStore'
import { messagePreview } from './format'

// 预览行已读态 (旧 recentMessageState ~427): 仅当最后一条是自己发的才有意义。
//  - 'none': 不显示
//  - 'sent': 已送达(✓)  / 'read': 已读(✓✓)  (私聊)
//  - number: 群聊已读人数(N 已读), 0 表示无人已读不显示
export type LastReadState =
  | { kind: 'none' }
  | { kind: 'sent' }
  | { kind: 'read' }
  | { kind: 'count'; count: number }

// 会话列表项 (派生数据, 不入 store)。
export interface ConversationItem {
  key: string
  kind: 'room' | 'private'
  username: string // 私聊对方; 房间为空
  title: string
  avatar: string
  online: boolean
  last: ChatMessage | null
  preview: string
  timestamp: string
  unread: number
  lastReadState: LastReadState
}

function lastMessage(items: ChatMessage[] | undefined): ChatMessage | null {
  if (!items || !items.length) return null
  return items[items.length - 1]
}

// 预览行已读态 (移植自旧 recentMessageState ~427): 最后一条须自己发出且未撤回。
function lastReadStateOf(
  last: ChatMessage | null,
  self: string,
): LastReadState {
  if (!last || last.system || last.recalled) return { kind: 'none' }
  const from = last.from || last.username
  if (!self || from !== self) return { kind: 'none' }
  if (last.scope === 'private') {
    return last.readAt ? { kind: 'read' } : { kind: 'sent' }
  }
  // 群聊: 统计已读人数(排除自己)。
  const count = last.readBy.filter((r) => r.username !== self).length
  return count > 0 ? { kind: 'count', count } : { kind: 'none' }
}

function partnerMeta(
  username: string,
  directory: DirectoryUser[],
): { displayName: string; avatar: string; online: boolean } {
  const found = directory.find((u) => u.username === username)
  return {
    displayName: found?.displayName || username || '联系人',
    avatar: found?.avatar || '',
    online: Boolean(found?.online),
  }
}

// 派生左侧会话列表: 始终含「房间」会话 + 所有私聊会话, 按置顶/未读/时间排序, 经搜索过滤。
export function buildConversations(params: {
  messagesByConversation: Record<string, ChatMessage[]>
  directory: DirectoryUser[]
  roomScope: string
  unreadByKey: Record<string, number>
  pinned: Set<string>
  filter: string
  activeKey: string
  self: string
}): ConversationItem[] {
  const {
    messagesByConversation,
    directory,
    roomScope,
    unreadByKey,
    pinned,
    filter,
    activeKey,
    self,
  } = params

  const items: ConversationItem[] = []

  // 房间会话 (默认 activeKey === "" 指向它)
  const roomKey = roomConversationKey(roomScope)
  const roomMsgs =
    messagesByConversation[roomKey] ??
    messagesByConversation[activeKey === '' ? roomKey : ''] ??
    []
  const roomLast = lastMessage(roomMsgs)
  items.push({
    key: '',
    kind: 'room',
    username: '',
    title: roomScope && roomScope !== '-' ? `房间 · ${roomScope}` : '协作房间',
    avatar: '#',
    online: true,
    last: roomLast,
    preview: roomLast ? messagePreview(roomLast) : '房间广播消息会显示在这里',
    timestamp: roomLast?.recalledAt || roomLast?.timestamp || '',
    unread: unreadByKey[roomKey] ?? 0,
    lastReadState: lastReadStateOf(roomLast, self),
  })

  // 私聊会话: 来自历史 key (user:*)
  const privateKeys = new Set<string>()
  for (const key of Object.keys(messagesByConversation)) {
    if (key.startsWith('user:')) privateKeys.add(key)
  }
  // 当前选中的私聊即使无历史也要出现
  if (activeKey.startsWith('user:')) privateKeys.add(activeKey)

  for (const key of privateKeys) {
    const username = usernameFromKey(key)
    if (!username) continue
    const meta = partnerMeta(username, directory)
    const msgs = messagesByConversation[key] ?? []
    const last = lastMessage(msgs)
    items.push({
      key,
      kind: 'private',
      username,
      title: meta.displayName,
      avatar: meta.avatar,
      online: meta.online,
      last,
      preview: last ? messagePreview(last) : '还没有消息',
      timestamp: last?.recalledAt || last?.timestamp || '',
      unread: unreadByKey[privateConversationKey(username)] ?? 0,
      lastReadState: lastReadStateOf(last, self),
    })
  }

  // 搜索过滤 (房间项始终保留)
  const query = filter.trim().toLowerCase()
  const filtered = query
    ? items.filter(
        (it) =>
          it.kind === 'room' ||
          it.title.toLowerCase().includes(query) ||
          it.username.toLowerCase().includes(query) ||
          it.preview.toLowerCase().includes(query),
      )
    : items

  // 排序: 房间永远第一; 其余按 置顶 > 未读 > 时间。
  return filtered.sort((a, b) => {
    if (a.kind === 'room') return -1
    if (b.kind === 'room') return 1
    const ap = pinned.has(a.username) ? 1 : 0
    const bp = pinned.has(b.username) ? 1 : 0
    if (ap !== bp) return bp - ap
    if (a.unread !== b.unread) return b.unread - a.unread
    return b.timestamp.localeCompare(a.timestamp)
  })
}

export function activeConversationMessages(
  messagesByConversation: Record<string, ChatMessage[]>,
  activeKey: string,
  roomScope: string,
): ChatMessage[] {
  if (activeKey === '' || isRoomKey(activeKey)) {
    return messagesByConversation[roomConversationKey(roomScope)] ?? []
  }
  return messagesByConversation[activeKey] ?? []
}
