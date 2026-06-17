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

// 群聊已读回执用户 (旧 normalizeReadBy ~271)。
export interface ReadReceiptUser {
  username: string
  displayName: string
  readAt: string
}

// 编辑草稿 (旧 state.collab.editDraft ~5187)。
export interface ChatEditDraft {
  id: string
  preview: string
}

// 转发草稿 (旧 state.collab.forwardDraft ~5188)。
export interface ChatForwardDraft {
  id: string
  from: string
  displayName: string
  preview: string
  text: string
  attachments: ChatAttachment[]
}

// 对端输入中状态 (旧 state.collab.typingByConversation ~488)。
export interface TypingMeta {
  from: string
  displayName: string
  scope: ChatScope
  updatedAt: number
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
  readBy: ReadReceiptUser[]
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

  // 对端输入中 (按会话 key) (旧 typingByConversation ~488)
  typingByConversation: Record<string, TypingMeta>
  // 上线提醒所需: 已知在线用户集合 + 首批 presence 是否就绪 (旧 knownOnlineUsers/presenceReady ~3470)
  knownOnlineUsers: string[]
  presenceReady: boolean

  // 输入区草稿 (回复/编辑/转发) (旧 replyDraft/editDraft/forwardDraft)
  replyDraft: ChatReplyTarget | null
  editDraft: ChatEditDraft | null
  forwardDraft: ChatForwardDraft | null

  // UI
  activeKey: string // "" = 房间(默认), 或 "user:xxx"
  filter: string

  // 未读计数 (旧 unreadByConversation): 仅实时入站消息累加, 历史加载不计。
  unreadByKey: Record<string, number>

  // 动作
  setIdentity: (identity: Partial<ChatIdentity>) => void
  setConnection: (s: ConnectionState) => void
  setRoomScope: (scope: string) => void
  setDirectory: (users: DirectoryUser[]) => void
  setActiveKey: (key: string) => void
  setFilter: (filter: string) => void

  // 未读 (旧 increaseUnreadCount/clearUnreadCount)
  incrementUnread: (key: string) => void
  clearUnread: (key: string) => void

  // 对端输入中
  setTyping: (key: string, meta: TypingMeta) => void
  clearTyping: (key: string) => void
  // 上线提醒状态推进 (返回新上线的用户, 供调用方弹提示)
  advancePresence: (online: string[]) => { newlyOnline: string[]; ready: boolean }

  // 草稿
  setReplyDraft: (draft: ChatReplyTarget | null) => void
  setEditDraft: (draft: ChatEditDraft | null) => void
  setForwardDraft: (draft: ChatForwardDraft | null) => void
  clearDrafts: () => void

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
  typingByConversation: {},
  knownOnlineUsers: [],
  presenceReady: false,
  replyDraft: null,
  editDraft: null,
  forwardDraft: null,
  activeKey: '', // 默认房间
  filter: '',
  unreadByKey: {},

  setIdentity: (identity) =>
    set((s) => ({ identity: { ...s.identity, ...identity } })),
  setConnection: (connection) => set({ connection }),
  setRoomScope: (roomScope) => set({ roomScope: roomScope || '-' }),
  setDirectory: (directory) => set({ directory }),
  setActiveKey: (activeKey) => set({ activeKey }),
  setFilter: (filter) => set({ filter }),

  incrementUnread: (key) =>
    set((s) => {
      if (!key) return s
      return { unreadByKey: { ...s.unreadByKey, [key]: (s.unreadByKey[key] ?? 0) + 1 } }
    }),
  clearUnread: (key) =>
    set((s) => {
      if (!key || !s.unreadByKey[key]) return s
      const next = { ...s.unreadByKey }
      delete next[key]
      return { unreadByKey: next }
    }),

  setTyping: (key, meta) =>
    set((s) =>
      key ? { typingByConversation: { ...s.typingByConversation, [key]: meta } } : s,
    ),
  clearTyping: (key) =>
    set((s) => {
      if (!key || !(key in s.typingByConversation)) return s
      const next = { ...s.typingByConversation }
      delete next[key]
      return { typingByConversation: next }
    }),

  // 推进在线集合, 返回相对上次「新上线」的用户 (旧 setUserDirectory ~3470 的上线提醒逻辑)。
  advancePresence: (online) => {
    const known = new Set(get().knownOnlineUsers)
    const ready = get().presenceReady
    const self = get().identity.username
    const nextOnline = online.filter((u) => u && u !== self)
    const newlyOnline = ready
      ? nextOnline.filter((u) => !known.has(u))
      : []
    set({ knownOnlineUsers: nextOnline, presenceReady: true })
    return { newlyOnline, ready }
  },

  setReplyDraft: (replyDraft) =>
    set({ replyDraft, editDraft: null, forwardDraft: null }),
  setEditDraft: (editDraft) =>
    set({ editDraft, replyDraft: null, forwardDraft: null }),
  setForwardDraft: (forwardDraft) =>
    set({ forwardDraft, replyDraft: null, editDraft: null }),
  clearDrafts: () => set({ replyDraft: null, editDraft: null, forwardDraft: null }),

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
          // 合并 readBy: 新消息已读非空则覆盖, 否则保留旧值 (旧 mergeMessageIntoConversation)。
          const mergedReadBy =
            message.readBy && message.readBy.length
              ? message.readBy
              : next[idx].readBy
          next[idx] = { ...next[idx], ...message, readBy: mergedReadBy }
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
      typingByConversation: {},
      knownOnlineUsers: [],
      presenceReady: false,
      replyDraft: null,
      editDraft: null,
      forwardDraft: null,
      activeKey: '',
      filter: '',
      unreadByKey: {},
    }),
}))

// 当前 activeKey 对应的「会话存储 key」(房间会话 activeKey === "" 映射到 room:<scope>)。
export function storeKeyForActive(activeKey: string, roomScope: string): string {
  return activeKey === '' || isRoomKey(activeKey)
    ? roomConversationKey(roomScope)
    : activeKey
}
