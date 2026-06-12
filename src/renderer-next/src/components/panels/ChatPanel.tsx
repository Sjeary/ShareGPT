import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { roomConversationKey, useChatStore } from '@/store/useChatStore'
import type { ChatAttachment } from '@/store/useChatStore'
import type { CollabSettings } from '@/types/settings'
import { useChat } from '@/hooks/useChat'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { ConversationList } from './chat/ConversationList'
import { MessageBubble } from './chat/MessageBubble'
import { Composer } from './chat/Composer'
import {
  activeConversationMessages,
  buildConversations,
} from './chat/conversations'
import { avatarMark, formatDateLabel, isSameDay } from './chat/format'

// 协作聊天面板 (Telegram 式)。
// 左: 会话列表 (搜索 + Avatar + 预览 + 时间 + 未读)
// 右: 对话头 + 气泡滚动区 + 输入区
//
// 数据: 本地历史 + 协作 WebSocket (见 useChat / useChatStore)。
// 登录 (token) 归账户面板; 未登录时仅展示本地历史并禁用发送。
export function ChatPanel() {
  const chat = useChat()
  const settings = useAppStore((s) => s.settings)
  const selfUsername = useChatStore((s) => s.identity.username)
  const connection = useChatStore((s) => s.connection)
  const roomScope = useChatStore((s) => s.roomScope)
  const directory = useChatStore((s) => s.directory)
  const messagesByConversation = useChatStore((s) => s.messagesByConversation)
  const activeKey = useChatStore((s) => s.activeKey)
  const setActiveKey = useChatStore((s) => s.setActiveKey)
  const filter = useChatStore((s) => s.filter)
  const setFilter = useChatStore((s) => s.setFilter)

  const collab = (settings?.collab ?? {}) as Partial<CollabSettings>
  const pinned = useMemo(
    () => new Set(collab.pinned_users ?? []),
    [collab.pinned_users],
  )

  // 轻量未读计数: 收到非自己、非当前会话的消息时 +1; 切换会话清零。
  const [unreadByKey, setUnreadByKey] = useState<Record<string, number>>({})
  const lastSeenCount = useRef<Record<string, number>>({})

  useEffect(() => {
    const activeStoreKey =
      activeKey === '' ? roomConversationKey(roomScope) : activeKey
    setUnreadByKey((prev) => {
      const next = { ...prev }
      let changed = false
      for (const [key, list] of Object.entries(messagesByConversation)) {
        const prevCount = lastSeenCount.current[key] ?? 0
        const curCount = list.length
        if (curCount > prevCount) {
          const fresh = list.slice(prevCount)
          if (key !== activeStoreKey) {
            const incoming = fresh.filter(
              (m) => !m.system && m.from && m.from !== selfUsername,
            ).length
            if (incoming > 0) {
              next[key] = (next[key] ?? 0) + incoming
              changed = true
            }
          }
        }
        lastSeenCount.current[key] = curCount
      }
      // 当前会话清零
      if ((next[activeStoreKey] ?? 0) > 0) {
        next[activeStoreKey] = 0
        changed = true
      }
      return changed ? next : prev
    })
  }, [messagesByConversation, activeKey, roomScope, selfUsername])

  const conversations = useMemo(
    () =>
      buildConversations({
        messagesByConversation,
        directory,
        roomScope,
        unreadByKey,
        pinned,
        filter,
        activeKey,
      }),
    [
      messagesByConversation,
      directory,
      roomScope,
      unreadByKey,
      pinned,
      filter,
      activeKey,
    ],
  )

  const activeConversation = useMemo(
    () => conversations.find((c) => c.key === activeKey) ?? conversations[0],
    [conversations, activeKey],
  )

  const messages = useMemo(
    () => activeConversationMessages(messagesByConversation, activeKey, roomScope),
    [messagesByConversation, activeKey, roomScope],
  )

  // 自动滚动到底部
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, activeKey])

  const online = connection === 'online'

  function handleSend(text: string, attachments: ChatAttachment[]) {
    if (!activeConversation) return
    const scope = activeConversation.kind === 'private' ? 'private' : 'subnet'
    try {
      chat.sendMessage({
        text,
        scope,
        to: activeConversation.username,
        attachments,
      })
    } catch (err) {
      // 未连接时旧逻辑给出错误反馈; 这里用 toast 较轻量的方式由调用方处理。
      console.warn(String((err as Error)?.message || err))
    }
  }

  const subtitle = (() => {
    if (!activeConversation) return ''
    if (activeConversation.kind === 'room') {
      return `${directory.filter((u) => u.online).length} 人在线`
    }
    return activeConversation.online ? '在线' : '离线'
  })()

  return (
    <section className="flex min-w-0 flex-1">
      <ConversationList
        items={conversations}
        activeKey={activeKey}
        filter={filter}
        onFilterChange={setFilter}
        onSelect={setActiveKey}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 对话头 */}
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          {activeConversation ? (
            <>
              <Avatar size="default">
                <AvatarFallback
                  className={cn(
                    activeConversation.kind === 'room' &&
                      'bg-primary/15 text-primary',
                  )}
                >
                  {avatarMark(
                    activeConversation.avatar,
                    activeConversation.title,
                  )}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {activeConversation.title}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {subtitle}
                </div>
              </div>
              <span
                className={cn(
                  'flex items-center gap-1.5 text-xs',
                  online ? 'text-success' : 'text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'size-2 rounded-full',
                    online ? 'bg-success' : 'bg-muted-foreground/50',
                  )}
                />
                {connectionLabel(connection)}
              </span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">协作聊天</span>
          )}
        </div>

        {/* 消息滚动区 */}
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        >
          {messages.length === 0 ? (
            <div className="grid h-full place-items-center text-center text-sm text-muted-foreground">
              <div className="flex flex-col items-center gap-2">
                <MessageSquare className="size-8 opacity-40" />
                {activeConversation?.kind === 'private'
                  ? '这里还没有私聊记录。'
                  : '这个房间还没有消息记录。'}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {messages.map((message, i) => {
                const prev = i > 0 ? messages[i - 1] : null
                const showDate =
                  !prev || !isSameDay(prev.timestamp, message.timestamp)
                const mine =
                  !message.system && message.from === selfUsername
                const showAvatar =
                  !mine &&
                  (!prev ||
                    prev.system ||
                    prev.from !== message.from ||
                    showDate)
                return (
                  <div key={message.id || `${message.timestamp}-${i}`}>
                    {showDate && (
                      <div className="my-2 flex justify-center">
                        <span className="rounded-full bg-secondary px-3 py-0.5 text-xs text-muted-foreground">
                          {formatDateLabel(message.timestamp)}
                        </span>
                      </div>
                    )}
                    <MessageBubble
                      message={message}
                      mine={mine}
                      showAvatar={showAvatar}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 输入区 */}
        <Composer
          disabled={!online || !activeConversation}
          placeholder={
            online
              ? activeConversation?.kind === 'private'
                ? `发消息给 ${activeConversation.title}…`
                : '发送到房间…'
              : '登录账户后即可发送消息'
          }
          onSend={handleSend}
          onTyping={(active) => {
            if (!activeConversation) return
            chat.sendTyping(
              active,
              activeConversation.kind === 'private' ? 'private' : 'subnet',
              activeConversation.username,
            )
          }}
        />
      </div>
    </section>
  )
}

function connectionLabel(
  state: ReturnType<typeof useChatStore.getState>['connection'],
): string {
  switch (state) {
    case 'online':
      return '在线'
    case 'connecting':
      return '连接中'
    case 'closed':
      return '已断开'
    case 'error':
      return '连接异常'
    default:
      return '未登录'
  }
}
