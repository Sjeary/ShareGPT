import { create } from 'zustand'

// 协作聊天 store 切片 (本面板自有, 不污染 useAppStore)。
// 数据来源:
//  - 本地历史: window.api.loadChatHistory() / saveChatHistory()  (结构见旧 renderer.js ~325 serializeConversationStore)
//  - 实时: 协作服务器 WebSocket (wss?://host/ws?token=...)  (协议见旧 renderer.js ~4332)
//  - 在线联系人: GET {server}/api/users  (见旧 renderer.js ~4246)
// 会话 key 约定 (与旧版兼容, 复用本地历史):
//  - 房间(子网广播): `room:<scope>`
//  - 私聊:          `user:<username>`

export type ChatScope = 'subnet' | 'private'

export interface ChatAttachment {
  kind: 'image' | 'file'
  name: string
  mime: string
  size: number
  dataUrl: string
}

export interface ChatReplyTarget {
  id: string
  from: string
  displayName: string
  preview: string
  timestamp: string
}

export interface ChatForwardedFrom {
  from: string
  displayName: string
}

export interface ChatMessage {
  id: string
  type: string
  scope: ChatScope
  from: string
  to: string
  username: string
  displayName: string
  avatar: string
  text: string
  attachments: ChatAttachment[]
  replyTo: ChatReplyTarget | null
  forwardedFrom: ChatForwardedFrom | null
  timestamp: string
  readAt: string
  edited: boolean
  editedAt: string
  subnetKey: string
  subnetLabel: string
  system: boolean
  recalled: boolean
  recalledAt: string
}

export interface DirectoryUser {
  username: string
  displayName: string
  avatar: string
  online: boolean
}

export type ConnectionState =
  | 'idle' // 未登录 / 无 token
  | 'connecting'
  | 'online'
  | 'closed' // 断开
  | 'error'

export interface ChatIdentity {
  serverUrl: string
  token: string
  username: string
  displayName: string
  avatar: string
}

interface ChatState {
  // 身份 / 连接
  identity: ChatIdentity
  connection: ConnectionState
  roomScope: string

  // 数据
  messagesByConversation: Record<string, ChatMessage[]>
  directory: DirectoryUser[]

  // UI
  activeKey: string // "" = 房间(默认), 或 "user:xxx"
  filter: string

  // 动作
  setIdentity: (identity: Partial<ChatIdentity>) => void
  setConnection: (s: ConnectionState) => void
  setRoomScope: (scope: string) => void
  setDirectory: (users: DirectoryUser[]) => void
  setActiveKey: (key: string) => void
  setFilter: (filter: string) => void

  // 历史 (本地持久化反序列化)
  hydrate: (conversations: Record<string, ChatMessage[]>) => void
  // 合并一批消息 (history_sync / history)
  mergeMessages: (messages: ChatMessage[]) => void
  // 收到单条 (chat / chat_recall / chat_edit / system)
  upsertMessage: (message: ChatMessage) => void

  reset: () => void
}

const ROOM_PREFIX = 'room:'
const USER_PREFIX = 'user:'

export function roomConversationKey(scope: string): string {
  return `${ROOM_PREFIX}${scope || '-'}`
}

export function privateConversationKey(username: string): string {
  const u = (username || '').trim()
  return u ? `${USER_PREFIX}${u}` : ''
}

export function usernameFromKey(key: string): string {
  return key.startsWith(USER_PREFIX) ? key.slice(USER_PREFIX.length) : ''
}

export function isRoomKey(key: string): boolean {
  return key.startsWith(ROOM_PREFIX)
}

// 计算某条消息归属的会话 key (移植自旧 renderer.js conversationKeyForMessage ~3612)
function keyForMessage(message: ChatMessage, self: string, roomScope: string): string {
  if (message.scope === 'private') {
    const fromUser = message.from
    const toUser = message.to
    const other = message.system
      ? toUser
      : fromUser === self
        ? toUser
        : fromUser || message.username
    return privateConversationKey(other)
  }
  const roomId = message.subnetLabel || message.subnetKey || roomScope
  return roomConversationKey(roomId)
}

function dedupeFingerprint(m: ChatMessage): string {
  return [m.scope, m.from, m.to, m.timestamp, m.text, m.recalled, m.attachments.length].join('|')
}

const INITIAL_IDENTITY: ChatIdentity = {
  serverUrl: '',
  token: '',
  username: '',
  displayName: '',
  avatar: '',
}

export const useChatStore = create<ChatState>((set, get) => ({
  identity: INITIAL_IDENTITY,
  connection: 'idle',
  roomScope: '-',
  messagesByConversation: {},
  directory: [],
  activeKey: '', // 默认房间
  filter: '',

  setIdentity: (identity) =>
    set((s) => ({ identity: { ...s.identity, ...identity } })),
  setConnection: (connection) => set({ connection }),
  setRoomScope: (roomScope) => set({ roomScope: roomScope || '-' }),
  setDirectory: (directory) => set({ directory }),
  setActiveKey: (activeKey) => set({ activeKey }),
  setFilter: (filter) => set({ filter }),

  hydrate: (conversations) => {
    const cleaned: Record<string, ChatMessage[]> = {}
    for (const [key, items] of Object.entries(conversations || {})) {
      if (!Array.isArray(items) || !items.length) continue
      cleaned[key] = items.slice(-300)
    }
    set({ messagesByConversation: cleaned })
  },

  mergeMessages: (messages) => {
    for (const m of messages) get().upsertMessage(m)
  },

  upsertMessage: (message) => {
    const { identity, roomScope } = get()
    const key = keyForMessage(message, identity.username, roomScope)
    if (!key) return
    set((s) => {
      const list = s.messagesByConversation[key] ?? []
      const next = [...list]
      // 按 id 更新 (撤回/编辑/已读)
      if (message.id) {
        const idx = next.findIndex((x) => x.id === message.id)
        if (idx >= 0) {
          next[idx] = { ...next[idx], ...message }
          return {
            messagesByConversation: { ...s.messagesByConversation, [key]: next },
          }
        }
      }
      // 指纹去重
      const fp = dedupeFingerprint(message)
      if (next.some((x) => dedupeFingerprint(x) === fp)) {
        return s
      }
      next.push(message)
      if (next.length > 300) next.splice(0, next.length - 300)
      return {
        messagesByConversation: { ...s.messagesByConversation, [key]: next },
      }
    })
  },

  reset: () =>
    set({
      identity: INITIAL_IDENTITY,
      connection: 'idle',
      roomScope: '-',
      messagesByConversation: {},
      directory: [],
      activeKey: '',
      filter: '',
    }),
}))
