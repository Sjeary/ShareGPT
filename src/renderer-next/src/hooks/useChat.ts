import { useCallback, useEffect, useMemo, useRef } from 'react'
import { api } from '@/lib/api'
import { wsBus } from '@/lib/wsBus'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/store/useAuthStore'
import {
  chatViewKey,
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
import { playNotificationTone, showNotificationToast, showSystemNotification } from '@/lib/notify'
import {
  hydrateConversations,
  normalizeChatMessage,
  normalizeDirectory,
  serializeConversations,
} from '@/components/panels/chat/normalize'
import { messagePreview } from '@/components/panels/chat/format'
import {
  discardCollabToken,
  fetchAndApplyAuthoritativeClientBootstrap,
  invalidateClientProxyAuthorization,
} from '@/hooks/clientBootstrap'
import { requireConfirmedLoginResponse } from '@/lib/collabLoginTransaction'
import { createSingleFlight } from '@/lib/singleFlight'
import {
  settingsPrincipalRuntime,
  type SettingsPrincipalSnapshot,
} from '@/lib/settingsPrincipalRuntime'

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
function incomingConversationKey(message: ChatMessage, self: string, roomScope: string): string {
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

// —— 本地历史「按群」隔离 ——
// 单个 chat_history.json 内, 会话 key 以 `<群(serverUrl)>\0<会话key>` 前缀区分不同群;
// 旧版无前缀(legacy)会话视为「首个登录的群」的历史(迁移)。这样一个客户端连不同群时,
// 本地缓存各群独立, 登录即切换, 不再串台。
const GROUP_SEP = '\u0000'

function splitFileKey(fileKey: string): { group: string; conv: string } {
  const i = fileKey.indexOf(GROUP_SEP)
  return i >= 0
    ? { group: fileKey.slice(0, i), conv: fileKey.slice(i + 1) }
    : { group: '', conv: fileKey }
}

// 从「全量(含各群)」会话表中取出某群的会话 (会话 key 还原为不带前缀)。
// 严格只取本群前缀的会话; legacy(无前缀)在首次加载时已一次性迁移到某个群(见下), 不再被任何群继承,
// 从而保证「连不同群, 聊天各自独立, 不串台」。
function pickGroupConversations(
  all: Record<string, ChatMessage[]>,
  group: string,
): Record<string, ChatMessage[]> {
  const out: Record<string, ChatMessage[]> = {}
  for (const [fk, msgs] of Object.entries(all)) {
    const { group: g, conv } = splitFileKey(fk)
    if (g === group) out[conv] = msgs
  }
  return out
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
  const clearGroupCaches = useChatStore((s) => s.clearGroupCaches)
  const applyReaction = useChatStore((s) => s.applyReaction)

  const setTyping = useChatStore((s) => s.setTyping)
  const clearTyping = useChatStore((s) => s.clearTyping)
  const advancePresence = useChatStore((s) => s.advancePresence)

  const setSession = useAuthStore((s) => s.setSession)

  const wsRef = useRef<WebSocket | null>(null)
  const readReceipts = useRef<{
    socket: WebSocket | null
    byConversation: Map<string, Set<string>>
  }>({ socket: null, byConversation: new Map() })
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
  // 本地历史「按群」缓存: 整文件(含各群)读入此 ref; 当前已换入的群 key (= serverUrl)。
  const fileConvsRef = useRef<Record<string, ChatMessage[]>>({})
  const fileLoadedRef = useRef(false)
  const loadedGroupRef = useRef<string | null>(null)

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

  // 本地历史「按群」加载: 首次读入整文件; 登录或切到不同群(serverUrl)时, 清空内存缓存并换入该群会话。
  // 这样同一客户端连不同群, 消息/成员各群独立, 登录即切换, 不再串台。
  const group = identity.serverUrl
  useEffect(() => {
    if (!group) return // 未登录: 不切换 (登出/重置另行处理)
    let cancelled = false
    void (async () => {
      if (!fileLoadedRef.current) {
        try {
          fileConvsRef.current = hydrateConversations(await api.loadChatHistory())
        } catch {
          fileConvsRef.current = {}
        }
        fileLoadedRef.current = true
        // 一次性迁移: 老版本「无群前缀」的混合历史归并到当前群并落盘; 此后各群严格隔离, 不再相互串台。
        const hasLegacy = Object.keys(fileConvsRef.current).some(
          (fk) => splitFileKey(fk).group === '',
        )
        if (hasLegacy) {
          const migrated: Record<string, ChatMessage[]> = {}
          for (const [fk, msgs] of Object.entries(fileConvsRef.current)) {
            const { group: g, conv } = splitFileKey(fk)
            const key = g === '' ? `${group}${GROUP_SEP}${conv}` : fk
            if (!migrated[key]) migrated[key] = msgs
          }
          fileConvsRef.current = migrated
          void api.saveChatHistory(serializeConversations(migrated)).catch(() => undefined)
        }
      }
      if (cancelled || loadedGroupRef.current === group) return
      // 切群: 先清掉上一个群的内存缓存(消息/成员/未读/输入态/草稿), 再换入本群本地会话。
      clearGroupCaches()
      hydrate(pickGroupConversations(fileConvsRef.current, group))
      loadedGroupRef.current = group
    })()
    return () => {
      cancelled = true
    }
  }, [group, hydrate, clearGroupCaches])

  // 会话变更 -> 防抖持久化 (写回当前群的分片, 保留其它群; 切群未就绪时不写, 避免错群覆盖)。
  useEffect(() => {
    if (!group || loadedGroupRef.current !== group) return
    if (persistTimer.current) window.clearTimeout(persistTimer.current)
    persistTimer.current = window.setTimeout(() => {
      persistTimer.current = null
      const next: Record<string, ChatMessage[]> = {}
      for (const [fk, msgs] of Object.entries(fileConvsRef.current)) {
        const g = splitFileKey(fk).group
        if (g === group || g === '') continue // 丢弃旧的本群条目 + legacy(已迁移到本群)
        next[fk] = msgs // 保留其它群
      }
      for (const [conv, msgs] of Object.entries(useChatStore.getState().messagesByConversation)) {
        next[`${group}${GROUP_SEP}${conv}`] = msgs
      }
      fileConvsRef.current = next
      void api.saveChatHistory(serializeConversations(next)).catch(() => undefined)
    }, 300)
    return () => {
      if (persistTimer.current) window.clearTimeout(persistTimer.current)
    }
  }, [messagesByConversation, group])

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
    const route = {
      scope: message.scope,
      targetUsername: message.scope === 'private' ? message.from : '',
      roomScope: message.scope === 'subnet' ? message.subnetLabel || message.subnetKey : '',
      messageId: message.id,
    }

    if (cfg.notify_message_popup) showNotificationToast(title, preview, route)
    if (cfg.notify_system_notification) {
      void showSystemNotification(title, preview, route)
    }
    if (cfg.notify_sound_play) playNotificationTone()
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
    const viewKey = chatViewKey(settingsPrincipalRuntime.current().principalId, key)
    const visible =
      appActive === 'chat' &&
      key === activeStoreKey &&
      focused &&
      state.readingActiveView === viewKey &&
      state.readingPositions[viewKey]?.atBottom
    if (visible) return
    state.incrementUnread(key, message.id)
  }, [])

  // 对端 typing (移植自旧 chat_typing 分支 ~4427 + setConversationTyping ~488)。
  const handleTyping = useCallback(
    (payload: Record<string, unknown>) => {
      const scope: ChatScope = String(payload.scope) === 'private' ? 'private' : 'subnet'
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
    const authorizationInvalidation = createSingleFlight<void>()

    const invalidateAuthorization = (
      principalSnapshot: SettingsPrincipalSnapshot,
    ): Promise<void> => {
      return authorizationInvalidation.run(() =>
        invalidateClientProxyAuthorization({ principalSnapshot }),
      )
    }

    // 账号授权失效或必须重新登录时，停止 sender 并撤下当前进程的线路授权。
    const stopSenderForAccountOffline = () => {
      try {
        void invalidateAuthorization(settingsPrincipalRuntime.snapshot()).catch(() => {})
      } catch {
        void api.stopSender().catch(() => {})
      }
    }

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
      const previousToken = useChatStore.getState().identity.token
      const password = useAuthStore.getState().runtimePassword
      if (!serverUrl || !username || !password) {
        manualReloginRef.current = '服务已重启，请重新登录。'
        setConnection('error')
        showNotificationToast('需要重新登录', manualReloginRef.current)
        stopSenderForAccountOffline()
        return
      }
      let principalSnapshot: SettingsPrincipalSnapshot
      try {
        principalSnapshot = settingsPrincipalRuntime.snapshot()
      } catch {
        // A Principal transition invalidates this reconnect attempt before it starts.
        return
      }
      silentReloginInFlight.current = true
      setConnection('connecting')
      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), SILENT_LOGIN_TIMEOUT_MS)
      let issuedToken = ''
      try {
        try {
          await invalidateAuthorization(principalSnapshot)
        } catch (error) {
          // Runtime authorization is cleared before persistence is attempted. A disk failure must
          // leave routes fail closed, but it must not turn a valid chat login into a failed login.
          console.warn(
            'Silent collaboration login continued after proxy invalidation failed',
            error,
          )
        }
        settingsPrincipalRuntime.assertCurrent(principalSnapshot)
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
        const payload = await requireConfirmedLoginResponse<{
          token: string
          username: string
          profile?: {
            avatar?: string
            displayName?: string
            isAdmin?: boolean
            advancedAiAllowed?: boolean
            allowedProxyRouteIds?: string[]
            chatDisabled?: boolean
          }
        }>(res)
        issuedToken = payload.token
        if (payload.username.trim() !== username) {
          throw new Error('服务器返回的账号身份与当前会话不一致')
        }
        try {
          await fetchAndApplyAuthoritativeClientBootstrap(serverUrl, issuedToken, {
            allowLegacyAdminConfig: Boolean(payload.profile?.isAdmin),
            managedConfigEditable: Boolean(
              payload.profile?.isAdmin || payload.profile?.advancedAiAllowed,
            ),
            principalSnapshot,
          })
        } catch (error) {
          // Collaboration authentication and route authorization are separate. Keep the refreshed
          // chat token while the already-invalidated route authorization remains fail closed.
          console.warn('Silent collaboration login continued without proxy authorization', error)
        }
        settingsPrincipalRuntime.assertCurrent(principalSnapshot)
        if (cancelled) {
          await discardCollabToken(serverUrl, issuedToken)
          return
        }
        const displayName = (payload.profile?.displayName ?? '').trim() || username
        const avatar = (payload.profile?.avatar ?? '').trim()
        // 权威线路已经应用后才写回运行期 token。
        setSession({
          token: issuedToken,
          profile: {
            username,
            displayName,
            avatar,
            isAdmin: Boolean(payload.profile?.isAdmin),
            advancedAiAllowed: Boolean(
              payload.profile?.isAdmin || payload.profile?.advancedAiAllowed,
            ),
            allowedProxyRouteIds: Array.isArray(payload.profile?.allowedProxyRouteIds)
              ? payload.profile.allowedProxyRouteIds
              : [],
            chatDisabled: Boolean(payload.profile?.chatDisabled),
          },
          password,
        })
        useChatStore.getState().setIdentity({
          token: issuedToken,
          displayName,
          avatar,
        })
        silentReloginInFlight.current = false
        // A fresh token rebuilds this effect and opens exactly one socket. Only a server that
        // reuses the same token needs an explicit reconnect because the dependency does not change.
        if (!cancelled && issuedToken === previousToken) connect()
      } catch (err) {
        if (issuedToken) await discardCollabToken(serverUrl, issuedToken)
        silentReloginInFlight.current = false
        const message = err instanceof Error ? err.message : String(err)
        if (MANUAL_RELOGIN_PATTERN.test(message)) {
          manualReloginRef.current = '登录状态已失效，请重新登录。'
          setConnection('error')
          showNotificationToast('需要重新登录', manualReloginRef.current)
          stopSenderForAccountOffline()
          return
        }
        // 网络类错误: 继续退避重试。
        scheduleReconnect('relogin')
      } finally {
        silentReloginInFlight.current = false
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
          ws.send(JSON.stringify({ type: 'history_sync', since: latestHistoryCursor() }))
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

        // 转发给 WS 总线: 其它功能(云同步 / 组队日历)复用这条唯一连接, 不再自建 WS,
        // 否则同账号第二条 WS 会触发服务器「账号在别处登录」把本连接踢掉。
        wsBus.publish(payload)

        switch (type) {
          case 'presence': {
            if (payload.roomScope) setRoomScope(String(payload.roomScope))
            void refreshDirectory()
            break
          }
          case 'session': {
            const me = String(payload.username || '')
            if (me) setIdentity({ username: me })
            if (payload.displayName) setIdentity({ displayName: String(payload.displayName) })
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
            const current = useChatStore.getState()
            const conversationKey = incomingConversationKey(
              message,
              current.identity.username,
              current.roomScope,
            )
            const alreadyReceived = Boolean(
              message.id &&
              current.messagesByConversation[conversationKey]?.some(
                (item) => item.id === message.id,
              ),
            )
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
            if (!alreadyReceived) {
              maybeNotifyIncoming(message)
              trackUnread(message)
            }
            break
          }
          case 'chat_typing': {
            handleTyping(payload)
            break
          }
          case 'chat_recall':
          case 'chat_edit': {
            if (payload.message) upsertMessage(normalizeChatMessage(payload.message))
            break
          }
          case 'chat_reaction': {
            applyReaction(
              String(payload.messageId ?? '').trim(),
              (payload.reactions as Record<string, string[]>) || {},
            )
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
          stopSenderForAccountOffline()
          return
        }
        if (event?.code === 4002) {
          const reason = String(event.reason || '')
          if (reason === 'client_config_updated' || reason === 'proxy_catalog_updated') {
            showNotificationToast(
              '团队网络配置已更新',
              '正在同步管理员的新设置；原线路已安全停止，请稍后重新开启代理。',
            )
          }
          stopSenderForAccountOffline()
          if (hasResume) scheduleReconnect('relogin')
          else {
            manualReloginRef.current = '服务已重启，请重新登录。'
            setConnection('error')
            stopSenderForAccountOffline()
          }
          return
        }
        if (opened) scheduleReconnect('socket')
        else if (hasResume) scheduleReconnect('relogin')
        else {
          manualReloginRef.current = '服务连接已失效，请重新登录。'
          setConnection('error')
          stopSenderForAccountOffline()
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
    setConnection,
    setIdentity,
    setRoomScope,
    setSession,
    trackUnread,
    upsertMessage,
    applyReaction,
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
      showNotificationToast('联系人已上线', `${user?.displayName || username} 现在在线。`)
    }
  }, [directory, advancePresence])

  // 发送消息 (移植自旧 renderer.js sendChatMessage ~5180 的 chat payload)。
  const sendMessage = useCallback((input: SendMessageInput) => {
    const text = (input.text || '').trim()
    const attachments = input.attachments ?? []
    if (!text && !attachments.length) return false
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('消息服务连接已断开，草稿已保留，请连接后重试。')
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
  }, [])

  // 批量已读: 当前会话可见时, 对会话中所有未读对端消息发已读回执
  // (移植自旧 markVisiblePrivateConversationRead/markVisibleRoomConversationRead ~2021/2046,
  //  history_sync / 打开会话时调用)。
  const markConversationRead = useCallback(
    (messages: ChatMessage[], scope: ChatScope, partner: string) => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      const self = useChatStore.getState().identity.username
      if (readReceipts.current.socket !== ws)
        readReceipts.current = { socket: ws, byConversation: new Map() }
      const conversation = JSON.stringify([scope, partner, useChatStore.getState().roomScope])
      const previous = readReceipts.current.byConversation.get(conversation) ?? new Set<string>()
      const ids = [
        ...new Set(
          messages
            .filter(
              (m) =>
                !m.system && !m.recalled && m.id && m.from && m.from !== self && m.scope === scope,
            )
            .map((m) => m.id)
            .filter((id) => !previous.has(id)),
        ),
      ]
      if (!ids.length) return
      try {
        if (scope === 'private') {
          if (!partner) return
          ws.send(JSON.stringify({ type: 'chat_read', with: partner, messageIds: ids }))
        } else {
          ws.send(JSON.stringify({ type: 'chat_read', scope: 'subnet', messageIds: ids }))
        }
        const retained = new Set(messages.filter((m) => previous.has(m.id)).map((m) => m.id))
        for (const id of ids) retained.add(id)
        readReceipts.current.byConversation.set(conversation, retained)
      } catch {
        /* ignore */
      }
    },
    [],
  )

  const sendTyping = useCallback((active: boolean, scope: 'subnet' | 'private', to: string) => {
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
  }, [])

  function requireOpenSocket(): WebSocket {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('当前未连接消息服务，请连接后重试。')
    }
    return ws
  }

  // 撤回 (双向删除) (移植自旧 recallOwnMessage ~4696)。
  const sendRecall = useCallback((messageId: string) => {
    const id = (messageId || '').trim()
    if (!id) return
    requireOpenSocket().send(JSON.stringify({ type: 'chat_recall', messageId: id }))
  }, [])

  // 表情回应: 切换 (服务端 toggle 后广播 chat_reaction)。
  const sendReaction = useCallback((messageId: string, emoji: string) => {
    const id = (messageId || '').trim()
    const e = (emoji || '').trim()
    if (!id || !e) return
    requireOpenSocket().send(JSON.stringify({ type: 'chat_react', messageId: id, emoji: e }))
  }, [])

  // 编辑 (移植自旧 sendChatMessage 的 chat_edit 分支 ~5200)。
  const sendEdit = useCallback((messageId: string, text: string) => {
    const id = (messageId || '').trim()
    const body = (text || '').trim()
    if (!id) return
    if (!body) throw new Error('编辑后的消息内容不能为空。')
    requireOpenSocket().send(JSON.stringify({ type: 'chat_edit', messageId: id, text: body }))
  }, [])

  // 转发 (移植自旧 sendChatMessage 的 forwardDraft 分支 ~5226)。
  const sendForward = useCallback(
    (draft: ChatForwardDraft, scope: 'subnet' | 'private', to: string) => {
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
      sendReaction,
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
      sendReaction,
      sendForward,
      markConversationRead,
      refreshDirectory,
    ],
  )
}

export type { ChatMessage }
