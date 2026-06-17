import { useCallback, useEffect, useMemo, useRef } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/store/useAuthStore'
import {
  privateConversationKey,
  roomConversationKey,
  storeKeyForActive,
  usernameFromKey,
  useChatStore,
  type ChatAttachment,
  type ChatForwardDraft,
  type ChatMessage,
  type ChatReplyTarget,
  type ChatScope,
} from '@/store/useChatStore'
import type { CollabSettings } from '@/types/settings'
import {
  playNotificationTone,
  showNotificationToast,
  showSystemNotification,
} from '@/lib/notify'
import {
  hydrateConversations,
  normalizeChatMessage,
  normalizeDirectory,
  serializeConversations,
} from '@/components/panels/chat/normalize'
import { messagePreview } from '@/components/panels/chat/format'

// 协作聊天主控 hook。
// 职责:
//  1. 从设置 + 登录态推导身份 (server_url / username), 加载本地历史。
//  2. 维护协作 WebSocket (实时收发); token 由账户面板登录后写入 store.identity。
//  3. 暴露 sendMessage / selectConversation / refreshDirectory。
//  4. 把会话变更防抖持久化到 window.api.saveChatHistory。
//
// 注意: 登录(获取 token)归账户面板。本 hook 在拿到 token 前只渲染本地历史,
//       WS 不会连接 (留 TODO: token 注入)。

function toWsUrl(httpUrl: string, token: string): string {
  const normalized = (httpUrl || '').replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error('服务地址需要以 http:// 或 https:// 开头')
  }
  const base = normalized.startsWith('https://')
    ? `wss://${normalized.slice('https://'.length)}/ws`
    : `ws://${normalized.slice('http://'.length)}/ws`
  return `${base}?token=${encodeURIComponent(token)}`
}

export interface SendMessageInput {
  text: string
  scope: 'subnet' | 'private'
  to: string
  replyTo?: ChatReplyTarget | null
  attachments?: ChatAttachment[]
}

const RECONNECT_MAX_DELAY = 12000
const RECONNECT_BASE_DELAY = 1500
const TYPING_EXPIRY_MS = 3200
const SILENT_LOGIN_TIMEOUT_MS = 10000

// 静默重登失败时, 据错误判断是否需要用户手动重登 (移植自旧 attemptSilentCollabRelogin ~4665)。
const MANUAL_RELOGIN_PATTERN = /401|403|账号|密码|登录失败|失效|未授权/i

// history_sync 增量游标: 取所有已存消息的 max(readAt, recalledAt, editedAt, timestamp), 空则 ''。
// (旧版固定 since:'' 全量; 这里改为增量, 减少重复历史拉取)。
function latestHistoryCursor(): string {
  let cursor = ''
  const byConv = useChatStore.getState().messagesByConversation
  for (const list of Object.values(byConv)) {
    for (const m of list) {
      const candidate = [m.readAt, m.recalledAt, m.editedAt, m.timestamp]
        .filter(Boolean)
        .reduce((a, b) => (a > b ? a : b), '')
      if (candidate > cursor) cursor = candidate
    }
  }
  return cursor
}

// 计算某条入站消息归属的会话存储 key (与 store.keyForMessage 对齐, 用于通知/已读判定)。
function incomingConversationKey(
  message: ChatMessage,
  self: string,
  roomScope: string,
): string {
  if (message.scope === 'private') {
    const other = message.system
      ? message.to
      : message.from === self
        ? message.to
        : message.from || message.username
    return privateConversationKey(other)
  }
  const roomId = message.subnetLabel || message.subnetKey || roomScope
  return roomConversationKey(roomId)
}

export function useChat() {
  const settings = useAppStore((s) => s.settings)
  const authed = useAppStore((s) => s.authed)

  const identity = useChatStore((s) => s.identity)
  const connection = useChatStore((s) => s.connection)
  const setIdentity = useChatStore((s) => s.setIdentity)
  const setConnection = useChatStore((s) => s.setConnection)
  const setRoomScope = useChatStore((s) => s.setRoomScope)
  const setDirectory = useChatStore((s) => s.setDirectory)
  const hydrate = useChatStore((s) => s.hydrate)
  const mergeMessages = useChatStore((s) => s.mergeMessages)
  const upsertMessage = useChatStore((s) => s.upsertMessage)
  const messagesByConversation = useChatStore((s) => s.messagesByConversation)

  const setTyping = useChatStore((s) => s.setTyping)
  const clearTyping = useChatStore((s) => s.clearTyping)
  const advancePresence = useChatStore((s) => s.advancePresence)

  const setSession = useAuthStore((s) => s.setSession)

  const wsRef = useRef<WebSocket | null>(null)
  const persistTimer = useRef<number | null>(null)
  // 重连/重登状态 (移植自旧 state.collab.reconnect* / silentReloginInFlight)。
  const reconnectTimer = useRef<number | null>(null)
  const reconnectAttempt = useRef(0)
  const reconnectStrategy = useRef<'socket' | 'relogin'>('socket')
  const silentReloginInFlight = useRef(false)
  const intentionalClose = useRef(false)
  // 对端 typing 过期定时器 (旧 typingExpiryTimers ~500)。
  const typingTimers = useRef<Map<string, number>>(new Map())
  // 需要手动重登时由 connect 设置, 供 UI 读取提示。
  const manualReloginRef = useRef('')

  const collab = (settings?.collab ?? {}) as Partial<CollabSettings>

  // 从设置推导服务器地址/用户名 (token 由登录写入)。
  useEffect(() => {
    setIdentity({
      serverUrl: (collab.server_url ?? '').replace(/\/+$/, ''),
      username: collab.last_username ?? '',
      avatar: collab.last_avatar ?? '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collab.server_url, collab.last_username, collab.last_avatar])

  // 启动时加载本地聊天历史。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const payload = await api.loadChatHistory()
        if (!cancelled) hydrate(hydrateConversations(payload))
      } catch {
        /* 本地历史读取失败可忽略 */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hydrate])

  // 会话变更 -> 防抖持久化。
  useEffect(() => {
    if (persistTimer.current) window.clearTimeout(persistTimer.current)
    persistTimer.current = window.setTimeout(() => {
      persistTimer.current = null
      void api
        .saveChatHistory(serializeConversations(messagesByConversation))
        .catch(() => undefined)
    }, 300)
    return () => {
      if (persistTimer.current) window.clearTimeout(persistTimer.current)
    }
  }, [messagesByConversation])

  // 拉取在线联系人目录。
  const refreshDirectory = useCallback(async () => {
    const { serverUrl, token } = useChatStore.getState().identity
    if (!serverUrl || !token) return
    try {
      const res = await fetch(`${serverUrl}/api/users`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const payload = (await res.json()) as {
        users?: unknown
        roomScope?: string
      }
      if (payload.roomScope) setRoomScope(payload.roomScope)
      setDirectory(normalizeDirectory(payload.users))
    } catch {
      /* 离线/网络错误忽略 */
    }
  }, [setDirectory, setRoomScope])

  // 收到非自己 / 非当前可见会话的 chat 消息时按设置开关触发通知
  // (移植自旧 handleIncomingConversationMessage ~3728: 弹窗 + 系统通知 + 提示音)。
  const maybeNotifyIncoming = useCallback((message: ChatMessage) => {
    if (message.system) return
    const state = useChatStore.getState()
    const self = state.identity.username
    if (!message.from || message.from === self) return

    const cfg = (useAppStore.getState().settings?.collab ?? {}) as Partial<CollabSettings>
    const appActive = useAppStore.getState().active
    const focused =
      typeof document === 'undefined'
        ? true
        : document.hasFocus() && document.visibilityState !== 'hidden'

    const key = incomingConversationKey(message, self, state.roomScope)
    const activeStoreKey = storeKeyForActive(state.activeKey, state.roomScope)
    const conversationVisible = appActive === 'chat' && key === activeStoreKey && focused
    if (conversationVisible) return

    const title = message.displayName || message.username
    const preview = messagePreview(message)

    if (cfg.notify_message_popup) showNotificationToast(title, preview)
    if (cfg.notify_system_notification) {
      void showSystemNotification(title, preview, {
        scope: message.scope,
        targetUsername: message.scope === 'private' ? message.from : '',
        roomScope:
          message.scope === 'subnet'
            ? message.subnetLabel || message.subnetKey
            : '',
        messageId: message.id,
      })
    }
    if (cfg.notify_sound_play) playNotificationTone()
  }, [])

  // 已读回执: 当前会话可见时, 对收到的未读对端消息回 chat_read
  // (移植自旧 sendPrivateReadReceipt/sendRoomReadReceipt ~1992)。
  const sendReadReceipt = useCallback((message: ChatMessage) => {
    if (message.system || !message.id) return
    const state = useChatStore.getState()
    const self = state.identity.username
    if (!message.from || message.from === self) return

    const appActive = useAppStore.getState().active
    const focused =
      typeof document === 'undefined'
        ? true
        : document.hasFocus() && document.visibilityState !== 'hidden'
    const key = incomingConversationKey(message, self, state.roomScope)
    const activeStoreKey = storeKeyForActive(state.activeKey, state.roomScope)
    if (!(appActive === 'chat' && key === activeStoreKey && focused)) return

    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    try {
      if (message.scope === 'private') {
        ws.send(
          JSON.stringify({
            type: 'chat_read',
            with: message.from,
            messageIds: [message.id],
          }),
        )
      } else {
        ws.send(
          JSON.stringify({
            type: 'chat_read',
            scope: 'subnet',
            messageIds: [message.id],
          }),
        )
      }
    } catch {
      /* ignore */
    }
  }, [])

  // 未读计数 (旧 increaseUnreadCount): 仅对「实时」入站消息生效, 且会话不可见时才 +1。
  // 历史加载走 mergeMessages 不经此处, 故重新登录不会把已读历史重新标未读。
  const trackUnread = useCallback((message: ChatMessage) => {
    if (message.system || !message.from) return
    const state = useChatStore.getState()
    const self = state.identity.username
    if (message.from === self) return

    const appActive = useAppStore.getState().active
    const focused =
      typeof document === 'undefined'
        ? true
        : document.hasFocus() && document.visibilityState !== 'hidden'
    const key = incomingConversationKey(message, self, state.roomScope)
    const activeStoreKey = storeKeyForActive(state.activeKey, state.roomScope)
    const visible = appActive === 'chat' && key === activeStoreKey && focused
    if (visible) return
    state.incrementUnread(key)
  }, [])

  // 对端 typing (移植自旧 chat_typing 分支 ~4427 + setConversationTyping ~488)。
  const handleTyping = useCallback(
    (payload: Record<string, unknown>) => {
      const scope: ChatScope =
        String(payload.scope) === 'private' ? 'private' : 'subnet'
      const from = String(payload.from ?? '').trim()
      const self = useChatStore.getState().identity.username
      if (!from || from === self) return
      const key =
        scope === 'private'
          ? privateConversationKey(from)
          : roomConversationKey(useChatStore.getState().roomScope)
      if (!key) return

      const timers = typingTimers.current
      const existing = timers.get(key)
      if (existing) window.clearTimeout(existing)

      if (!payload.active) {
        timers.delete(key)
        clearTyping(key)
        return
      }
      setTyping(key, {
        from,
        displayName: String(payload.displayName ?? from) || '对方',
        scope,
        updatedAt: Date.now(),
      })
      timers.set(
        key,
        window.setTimeout(() => {
          timers.delete(key)
          clearTyping(key)
        }, TYPING_EXPIRY_MS),
      )
    },
    [clearTyping, setTyping],
  )

  // WebSocket 实时连接 + 指数退避重连 + 静默重登。
  // 只有拿到 token (登录成功) 才连接。整套移植自旧 connectCollabWebSocket/scheduleCollabReconnect/
  // attemptSilentCollabRelogin (~4101 / ~4632)。
  useEffect(() => {
    if (!authed || !identity.token || !identity.serverUrl) {
      intentionalClose.current = true
      if (reconnectTimer.current) {
        window.clearTimeout(reconnectTimer.current)
        reconnectTimer.current = null
      }
      if (wsRef.current) {
        try {
          wsRef.current.close()
        } catch {
          /* ignore */
        }
        wsRef.current = null
      }
      setConnection('idle')
      return
    }

    intentionalClose.current = false
    manualReloginRef.current = ''
    reconnectAttempt.current = 0
    reconnectStrategy.current = 'socket'

    const typingTimersMap = typingTimers.current
    let cancelled = false

    // 指数退避重连: socket 策略直接重连; relogin 策略先静默刷新 token。
    const scheduleReconnect = (strategy: 'socket' | 'relogin') => {
      if (cancelled || intentionalClose.current || reconnectTimer.current) return
      if (strategy === 'relogin' && silentReloginInFlight.current) return
      reconnectStrategy.current = strategy
      const delay = Math.min(
        RECONNECT_MAX_DELAY,
        RECONNECT_BASE_DELAY * Math.max(1, reconnectAttempt.current + 1),
      )
      reconnectTimer.current = window.setTimeout(() => {
        reconnectTimer.current = null
        reconnectAttempt.current += 1
        if (reconnectStrategy.current === 'relogin') {
          void attemptSilentRelogin()
        } else {
          connect()
        }
      }, delay)
    }

    // 静默重登: 用 runtimePassword 直接 POST /api/login 刷新 token, 写回 auth + chat store。
    const attemptSilentRelogin = async () => {
      if (cancelled || silentReloginInFlight.current) return
      const serverUrl = useChatStore.getState().identity.serverUrl
      const username = useChatStore.getState().identity.username
      const password = useAuthStore.getState().runtimePassword
      if (!serverUrl || !username || !password) {
        manualReloginRef.current = '服务已重启，请重新登录。'
        setConnection('error')
        showNotificationToast('需要重新登录', manualReloginRef.current)
        return
      }
      silentReloginInFlight.current = true
      setConnection('connecting')
      const controller = new AbortController()
      const timer = window.setTimeout(
        () => controller.abort(),
        SILENT_LOGIN_TIMEOUT_MS,
      )
      try {
        const res = await fetch(`${serverUrl}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
          signal: controller.signal,
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(text || `登录失败（${res.status}）`)
        }
        const payload = (await res.json().catch(() => null)) as {
          token?: string
          profile?: { avatar?: string; displayName?: string }
        } | null
        if (!payload?.token) throw new Error('登录未成功')
        const displayName =
          (payload.profile?.displayName ?? '').trim() || username
        const avatar = (payload.profile?.avatar ?? '').trim()
        // 写回运行期会话 (不动 setAuthed/持久化设置, 仅刷新 token)。
        setSession({
          token: payload.token,
          profile: { username, displayName, avatar },
          password,
        })
        useChatStore.getState().setIdentity({
          token: payload.token,
          displayName,
          avatar,
        })
        silentReloginInFlight.current = false
        // identity.token 变化会触发本 effect 重建并重连; 这里主动重连以防 token 相同。
        if (!cancelled) connect()
      } catch (err) {
        silentReloginInFlight.current = false
        const message = err instanceof Error ? err.message : String(err)
        if (MANUAL_RELOGIN_PATTERN.test(message)) {
          manualReloginRef.current = '登录状态已失效，请重新登录。'
          setConnection('error')
          showNotificationToast('需要重新登录', manualReloginRef.current)
          return
        }
        // 网络类错误: 继续退避重试。
        scheduleReconnect('relogin')
      } finally {
        window.clearTimeout(timer)
      }
    }

    const connect = () => {
      if (cancelled || intentionalClose.current) return
      const { serverUrl, token } = useChatStore.getState().identity
      if (!token || !serverUrl) return
      let url: string
      try {
        url = toWsUrl(serverUrl, token)
      } catch {
        setConnection('error')
        return
      }

      setConnection('connecting')
      const ws = new WebSocket(url)
      wsRef.current = ws
      let opened = false

      ws.onopen = () => {
        if (cancelled) return
        opened = true
        reconnectAttempt.current = 0
        reconnectStrategy.current = 'socket'
        setConnection('online')
        void refreshDirectory()
        try {
          ws.send(
            JSON.stringify({ type: 'history_sync', since: latestHistoryCursor() }),
          )
        } catch {
          /* ignore */
        }
      }

      ws.onmessage = (event) => {
        if (cancelled) return
        let payload: Record<string, unknown>
        try {
          payload = JSON.parse(String(event.data || '{}'))
        } catch {
          return
        }
        const type = String(payload.type || '')

        switch (type) {
          case 'presence': {
            if (payload.roomScope) setRoomScope(String(payload.roomScope))
            void refreshDirectory()
            break
          }
          case 'session': {
            const me = String(payload.username || '')
            if (me) setIdentity({ username: me })
            if (payload.displayName)
              setIdentity({ displayName: String(payload.displayName) })
            if (payload.avatar) setIdentity({ avatar: String(payload.avatar) })
            if (payload.roomScope) setRoomScope(String(payload.roomScope))
            break
          }
          case 'history':
          case 'history_sync':
          case 'chat_read': {
            const list = Array.isArray(payload.messages) ? payload.messages : []
            mergeMessages(list.map((m) => normalizeChatMessage(m)))
            if (payload.roomScope) setRoomScope(String(payload.roomScope))
            break
          }
          case 'chat': {
            const message = normalizeChatMessage(payload)
            // 收到对端消息: 清除其 typing 提示 (旧 ~3735)。
            if (message.from && message.from !== useChatStore.getState().identity.username) {
              const key =
                message.scope === 'private'
                  ? privateConversationKey(message.from)
                  : roomConversationKey(useChatStore.getState().roomScope)
              const t = typingTimers.current.get(key)
              if (t) {
                window.clearTimeout(t)
                typingTimers.current.delete(key)
              }
              clearTyping(key)
            }
            upsertMessage(message)
            maybeNotifyIncoming(message)
            sendReadReceipt(message)
            trackUnread(message)
            break
          }
          case 'chat_typing': {
            handleTyping(payload)
            break
          }
          case 'chat_recall':
          case 'chat_edit': {
            if (payload.message)
              upsertMessage(normalizeChatMessage(payload.message))
            break
          }
          case 'system':
          case 'error': {
            upsertMessage(
              normalizeChatMessage({
                type: 'system',
                username: '系统通知',
                system: true,
                text: payload.text,
                scope: payload.scope ?? 'subnet',
                timestamp: payload.timestamp,
                roomScope: payload.roomScope,
              }),
            )
            break
          }
          default:
            break
        }
      }

      ws.onerror = () => {
        if (!cancelled) setConnection('error')
      }

      ws.onclose = (event) => {
        if (wsRef.current === ws) wsRef.current = null
        if (cancelled || intentionalClose.current) return
        setConnection('closed')
        // 重连策略 (移植自旧 ws.onclose ~4493):
        //  - 4003: 账号他处登录, 需手动重登。
        //  - 4002: 服务重启, 有凭据则静默重登。
        //  - 其他: 已连过则按 socket 重连; 否则若有凭据则尝试静默重登。
        const password = useAuthStore.getState().runtimePassword
        const hasResume = Boolean(
          useChatStore.getState().identity.serverUrl &&
            useChatStore.getState().identity.username &&
            password,
        )
        if (event?.code === 4003) {
          manualReloginRef.current = '当前账号已在其他地方登录，请重新登录。'
          setConnection('error')
          showNotificationToast('需要重新登录', manualReloginRef.current)
          return
        }
        if (event?.code === 4002) {
          if (hasResume) scheduleReconnect('relogin')
          else {
            manualReloginRef.current = '服务已重启，请重新登录。'
            setConnection('error')
          }
          return
        }
        if (opened) scheduleReconnect('socket')
        else if (hasResume) scheduleReconnect('relogin')
        else {
          manualReloginRef.current = '服务连接已失效，请重新登录。'
          setConnection('error')
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      intentionalClose.current = true
      if (reconnectTimer.current) {
        window.clearTimeout(reconnectTimer.current)
        reconnectTimer.current = null
      }
      for (const t of typingTimersMap.values()) window.clearTimeout(t)
      typingTimersMap.clear()
      const ws = wsRef.current
      if (ws) {
        ws.onopen = null
        ws.onmessage = null
        ws.onerror = null
        ws.onclose = null
        try {
          ws.close()
        } catch {
          /* ignore */
        }
      }
      wsRef.current = null
    }
  }, [
    authed,
    identity.token,
    identity.serverUrl,
    clearTyping,
    handleTyping,
    maybeNotifyIncoming,
    mergeMessages,
    refreshDirectory,
    sendReadReceipt,
    setConnection,
    setIdentity,
    setRoomScope,
    setSession,
    trackUnread,
    upsertMessage,
  ])

  // 上线提醒 (移植自旧 setUserDirectory ~3470): directory 变化时, 据 notify_user_online
  // 对「新上线」联系人弹提示。
  const directory = useChatStore((s) => s.directory)
  useEffect(() => {
    const online = directory.filter((u) => u.online).map((u) => u.username)
    const { newlyOnline } = advancePresence(online)
    const cfg = (useAppStore.getState().settings?.collab ?? {}) as Partial<CollabSettings>
    if (!cfg.notify_user_online || !newlyOnline.length) return
    for (const username of newlyOnline) {
      const user = directory.find((u) => u.username === username)
      showNotificationToast(
        '联系人已上线',
        `${user?.displayName || username} 现在在线。`,
      )
    }
  }, [directory, advancePresence])

  // 发送消息 (移植自旧 renderer.js sendChatMessage ~5180 的 chat payload)。
  const sendMessage = useCallback(
    (input: SendMessageInput) => {
      const text = (input.text || '').trim()
      const attachments = input.attachments ?? []
      if (!text && !attachments.length) return false
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error('消息服务尚未连接，请先登录账户。')
      }
      ws.send(
        JSON.stringify({
          type: 'chat',
          scope: input.scope,
          to: input.scope === 'private' ? input.to : '',
          text,
          replyTo: input.replyTo ?? null,
          attachments,
        }),
      )
      return true
    },
    [],
  )

  // 批量已读: 当前会话可见时, 对会话中所有未读对端消息发已读回执
  // (移植自旧 markVisiblePrivateConversationRead/markVisibleRoomConversationRead ~2021/2046,
  //  history_sync / 打开会话时调用)。
  const markConversationRead = useCallback(
    (messages: ChatMessage[], scope: ChatScope, partner: string) => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      const self = useChatStore.getState().identity.username
      const ids = [
        ...new Set(
          messages
            .filter(
              (m) =>
                !m.system &&
                !m.recalled &&
                m.id &&
                m.from &&
                m.from !== self &&
                m.scope === scope,
            )
            .map((m) => m.id),
        ),
      ]
      if (!ids.length) return
      try {
        if (scope === 'private') {
          if (!partner) return
          ws.send(
            JSON.stringify({ type: 'chat_read', with: partner, messageIds: ids }),
          )
        } else {
          ws.send(
            JSON.stringify({ type: 'chat_read', scope: 'subnet', messageIds: ids }),
          )
        }
      } catch {
        /* ignore */
      }
    },
    [],
  )

  const sendTyping = useCallback(
    (active: boolean, scope: 'subnet' | 'private', to: string) => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      try {
        ws.send(
          JSON.stringify({
            type: 'chat_typing',
            scope,
            to: scope === 'private' ? to : '',
            active,
          }),
        )
      } catch {
        /* ignore */
      }
    },
    [],
  )

  function requireOpenSocket(): WebSocket {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('当前未连接消息服务，请先登录账户。')
    }
    return ws
  }

  // 撤回 (双向删除) (移植自旧 recallOwnMessage ~4696)。
  const sendRecall = useCallback((messageId: string) => {
    const id = (messageId || '').trim()
    if (!id) return
    requireOpenSocket().send(
      JSON.stringify({ type: 'chat_recall', messageId: id }),
    )
  }, [])

  // 编辑 (移植自旧 sendChatMessage 的 chat_edit 分支 ~5200)。
  const sendEdit = useCallback((messageId: string, text: string) => {
    const id = (messageId || '').trim()
    const body = (text || '').trim()
    if (!id) return
    if (!body) throw new Error('编辑后的消息内容不能为空。')
    requireOpenSocket().send(
      JSON.stringify({ type: 'chat_edit', messageId: id, text: body }),
    )
  }, [])

  // 转发 (移植自旧 sendChatMessage 的 forwardDraft 分支 ~5226)。
  const sendForward = useCallback(
    (
      draft: ChatForwardDraft,
      scope: 'subnet' | 'private',
      to: string,
    ) => {
      requireOpenSocket().send(
        JSON.stringify({
          type: 'chat',
          scope,
          to: scope === 'private' ? to : '',
          text: (draft.text || '').trim(),
          forwardedFrom: {
            from: draft.from,
            displayName: draft.displayName,
          },
          attachments: draft.attachments ?? [],
        }),
      )
      return true
    },
    [],
  )

  return useMemo(
    () => ({
      connection,
      sendMessage,
      sendTyping,
      sendRecall,
      sendEdit,
      sendForward,
      markConversationRead,
      refreshDirectory,
      roomConversationKey,
      privateConversationKey,
      usernameFromKey,
    }),
    [
      connection,
      sendMessage,
      sendTyping,
      sendRecall,
      sendEdit,
      sendForward,
      markConversationRead,
      refreshDirectory,
    ],
  )
}

export type { ChatMessage }
