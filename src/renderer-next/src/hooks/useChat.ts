import { useCallback, useEffect, useMemo, useRef } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import {
  privateConversationKey,
  roomConversationKey,
  usernameFromKey,
  useChatStore,
  type ChatAttachment,
  type ChatMessage,
  type ChatReplyTarget,
} from '@/store/useChatStore'
import type { CollabSettings } from '@/types/settings'
import {
  hydrateConversations,
  normalizeChatMessage,
  normalizeDirectory,
  serializeConversations,
} from '@/components/panels/chat/normalize'

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

  const wsRef = useRef<WebSocket | null>(null)
  const persistTimer = useRef<number | null>(null)

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

  // WebSocket 实时连接。只有拿到 token (登录成功) 才连接。
  useEffect(() => {
    if (!authed || !identity.token || !identity.serverUrl) {
      // 没 token: 关闭已有连接, 仅展示本地历史。
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

    let disposed = false
    let url: string
    try {
      url = toWsUrl(identity.serverUrl, identity.token)
    } catch {
      setConnection('error')
      return
    }

    setConnection('connecting')
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      if (disposed) return
      setConnection('online')
      void refreshDirectory()
      // 增量同步: 旧版用 history_sync + since 游标; 这里请求全量增量。
      try {
        ws.send(JSON.stringify({ type: 'history_sync', since: '' }))
      } catch {
        /* ignore */
      }
    }

    ws.onmessage = (event) => {
      if (disposed) return
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
          upsertMessage(normalizeChatMessage(payload))
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
      if (!disposed) setConnection('error')
    }

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null
      if (!disposed) setConnection('closed')
    }

    return () => {
      disposed = true
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      if (wsRef.current === ws) wsRef.current = null
    }
  }, [
    authed,
    identity.token,
    identity.serverUrl,
    mergeMessages,
    refreshDirectory,
    setConnection,
    setIdentity,
    setRoomScope,
    upsertMessage,
  ])

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

  return useMemo(
    () => ({
      connection,
      sendMessage,
      sendTyping,
      refreshDirectory,
      roomConversationKey,
      privateConversationKey,
      usernameFromKey,
    }),
    [connection, sendMessage, sendTyping, refreshDirectory],
  )
}

export type { ChatMessage }
