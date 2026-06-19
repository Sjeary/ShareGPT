import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store/useAppStore'
import { privateConversationKey, storeKeyForActive, useChatStore } from '@/store/useChatStore'
import type { ChatAttachment, ChatForwardDraft, ChatMessage } from '@/store/useChatStore'
import type { CollabSettings } from '@/types/settings'
import { useChat } from '@/hooks/useChat'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { ConversationList } from './chat/ConversationList'
import { MessageBubble, type MessageActions } from './chat/MessageBubble'
import { Composer } from './chat/Composer'
import { ImageLightbox, type LightboxTarget } from './chat/ImageLightbox'
import { activeConversationMessages, buildConversations } from './chat/conversations'
import { avatarMark, formatDateLabel, isSameDay, messagePreview } from './chat/format'

// 由消息派生回复草稿 (旧 createReplyDraftFromMessage ~394)。
function replyDraftFromMessage(m: ChatMessage) {
  if (!m.id) return null
  return {
    id: m.id,
    from: m.from || m.username,
    displayName: m.displayName || m.username,
    preview: messagePreview(m).slice(0, 240) || '原消息',
    timestamp: m.timestamp,
  }
}

// 由消息派生转发草稿 (旧 setForwardDraftFromMessage ~4824)。
function forwardDraftFromMessage(m: ChatMessage): ChatForwardDraft | null {
  if (!m.id || m.recalled) return null
  return {
    id: m.id,
    from: m.from || m.username,
    displayName: m.displayName || m.username,
    preview: messagePreview(m).slice(0, 240) || '转发消息',
    text: m.text,
    attachments: m.attachments,
  }
}

// 找当前会话内自己最后一条可编辑消息 (旧 findLastOwnEditableMessage ~4857)。
function findLastOwnEditableMessage(messages: ChatMessage[], self: string): ChatMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]
    if (m.system || m.recalled) continue
    if ((m.from || m.username) !== self) continue
    if (m.attachments.length) continue
    if (!m.text) continue
    return m
  }
  return null
}

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
  const typingByConversation = useChatStore((s) => s.typingByConversation)
  const replyDraft = useChatStore((s) => s.replyDraft)
  const editDraft = useChatStore((s) => s.editDraft)
  const forwardDraft = useChatStore((s) => s.forwardDraft)
  const setReplyDraft = useChatStore((s) => s.setReplyDraft)
  const setEditDraft = useChatStore((s) => s.setEditDraft)
  const setForwardDraft = useChatStore((s) => s.setForwardDraft)
  const clearDrafts = useChatStore((s) => s.clearDrafts)
  // 未读计数改由 store 维护 (仅实时入站累加, 历史加载不计), 见 useChat.trackUnread。
  const unreadByKey = useChatStore((s) => s.unreadByKey)
  const clearUnread = useChatStore((s) => s.clearUnread)

  const collab = (settings?.collab ?? {}) as Partial<CollabSettings>
  const pinned = useMemo(() => new Set(collab.pinned_users ?? []), [collab.pinned_users])

  // 图片灯箱 (旧 openChatImageLightbox ~4975)。
  const [lightbox, setLightbox] = useState<LightboxTarget | null>(null)

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
        self: selfUsername,
      }),
    [
      messagesByConversation,
      directory,
      roomScope,
      unreadByKey,
      pinned,
      filter,
      activeKey,
      selfUsername,
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

  // 自动滚动到底部。
  // 旧实现仅在 useEffect 里同步设一次 scrollTop, 打开会话时面板可能尚未完成布局/可见
  // (高度为 0), 设置无效, 结果停在最顶部最旧消息。改为:
  //  - 切换会话时用双 rAF 等布局完成后强制贴底;
  //  - 新消息仅在用户「已贴底」时跟随, 向上翻看历史时不打断。
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  // 跟踪用户是否贴在底部 (距底 < 80px 视为贴底)。
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const onScroll = () => {
      const gap = node.scrollHeight - node.scrollTop - node.clientHeight
      stickToBottomRef.current = gap < 80
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [])

  // 打开 / 切换会话: 强制定位到最新消息 (双 rAF 处理初次可见与异步布局)。
  useEffect(() => {
    stickToBottomRef.current = true
    const node = scrollRef.current
    if (!node) return
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight
      raf2 = requestAnimationFrame(() => {
        node.scrollTop = node.scrollHeight
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [activeKey])

  // 新消息到达: 仅当用户已贴底时跟随到底, 否则保持当前阅读位置。
  useEffect(() => {
    if (!stickToBottomRef.current) return
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages])

  const online = connection === 'online'
  const scope: 'subnet' | 'private' = activeConversation?.kind === 'private' ? 'private' : 'subnet'

  // 切换会话时清空草稿 (旧逻辑: 切换联系人会重置输入意图)。
  useEffect(() => {
    clearDrafts()
  }, [activeKey, clearDrafts])

  // 会话可见时批量已读 (旧 markVisible*ConversationRead, 打开会话 / 收到历史后触发)。
  const appActive = useAppStore((s) => s.active)
  useEffect(() => {
    if (appActive !== 'chat' || connection !== 'online' || !activeConversation) return
    chat.markConversationRead(messages, scope, activeConversation.username)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appActive, connection, activeKey, messages])

  // 打开/查看会话即清除其未读标记 (旧 clearUnreadCount on open); 离线也清, 与旧版一致。
  useEffect(() => {
    if (appActive !== 'chat' || !activeConversation) return
    clearUnread(storeKeyForActive(activeKey, roomScope))
  }, [appActive, activeKey, roomScope, messages, activeConversation, clearUnread])

  // 对端「正在输入…」(旧 conversationTypingSummary ~510): 房间多人时汇总。
  const typingText = useMemo(() => {
    if (!activeConversation) return ''
    const storeKey = storeKeyForActive(activeKey, roomScope)
    if (activeConversation.kind === 'private') {
      const meta = typingByConversation[storeKey]
      if (!meta) return ''
      return `${meta.displayName || meta.from || '对方'} 正在输入…`
    }
    // 房间: 汇总同一 room key 下所有 subnet typer。
    const typers = Object.entries(typingByConversation).filter(
      ([key, meta]) => key === storeKey && meta.scope === 'subnet',
    )
    if (!typers.length) return ''
    if (typers.length === 1) {
      const meta = typers[0][1]
      return `${meta.displayName || meta.from || '联系人'} 正在输入…`
    }
    return `${typers.length} 位联系人正在输入…`
  }, [activeConversation, activeKey, roomScope, typingByConversation])

  // 群组成员名册: 展示「全部其他成员」(不再排除已聊过的人), 在线优先 + 按名排序;
  // 顶部搜索词作用于此列表。已聊过的人用 chattedUsernames 标注「已聊」。
  // 头部「X / Y 在线」的 Y 取全体成员总数 (不受搜索过滤影响), 修正旧版误用「未聊人数」当分母。
  const memberDirectory = useMemo(
    () => directory.filter((u) => u.username !== selfUsername),
    [directory, selfUsername],
  )
  const memberOnline = useMemo(
    () => memberDirectory.filter((u) => u.online).length,
    [memberDirectory],
  )
  const chattedUsernames = useMemo(
    () => new Set(conversations.filter((c) => c.kind === 'private').map((c) => c.username)),
    [conversations],
  )
  const contacts = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return memberDirectory
      .filter(
        (u) =>
          !q ||
          (u.displayName || '').toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1
        return (a.displayName || a.username).localeCompare(
          b.displayName || b.username,
          'zh-Hans-CN',
        )
      })
  }, [memberDirectory, filter])

  function reportSendError(err: unknown) {
    toast.error(String((err as Error)?.message || err))
  }

  function handleSend(text: string, attachments: ChatAttachment[]) {
    if (!activeConversation) return
    try {
      if (forwardDraft) {
        chat.sendForward(forwardDraft, scope, activeConversation.username)
      }
      if (text || attachments.length) {
        chat.sendMessage({
          text,
          scope,
          to: activeConversation.username,
          replyTo: replyDraft,
          attachments,
        })
      }
      clearDrafts()
    } catch (err) {
      reportSendError(err)
    }
  }

  function handleEditSubmit(id: string, text: string) {
    try {
      chat.sendEdit(id, text)
      clearDrafts()
    } catch (err) {
      reportSendError(err)
    }
  }

  // 从在线联系人开启私聊 (旧 pickPrivateTarget ~3445)。
  function handleStartPrivate(username: string) {
    if (!username || username === selfUsername) return
    setActiveKey(privateConversationKey(username))
  }

  // 跳转到被回复的原消息并临时高亮 (旧 focusMessageById ~4871)。
  function jumpToMessage(id: string) {
    if (!id) return
    const root = scrollRef.current
    const node = root?.querySelector<HTMLElement>(
      `[data-message-id="${(window.CSS?.escape ?? ((v: string) => v))(id)}"]`,
    )
    if (!node) return
    node.scrollIntoView({ block: 'center', behavior: 'smooth' })
    node.classList.add('chat-jump-target')
    window.setTimeout(() => node.classList.remove('chat-jump-target'), 1600)
  }

  const messageActions: MessageActions = {
    onReply: (m) => {
      const draft = replyDraftFromMessage(m)
      if (draft) setReplyDraft(draft)
    },
    onForward: (m) => {
      const draft = forwardDraftFromMessage(m)
      if (draft) setForwardDraft(draft)
    },
    onEdit: (m) => {
      if (!m.id || m.recalled || m.attachments.length) return
      setEditDraft({ id: m.id, preview: m.text })
    },
    onRecall: (m) => {
      try {
        chat.sendRecall(m.id)
      } catch (err) {
        reportSendError(err)
      }
    },
    onOpenImage: (dataUrl, alt) => setLightbox({ dataUrl, alt }),
    onJumpToMessage: jumpToMessage,
  }

  // ArrowUp 召回编辑自己最后一条可编辑消息 (旧 ~6088)。
  function handleArrowUpEdit() {
    const target = findLastOwnEditableMessage(messages, selfUsername)
    if (target?.id) setEditDraft({ id: target.id, preview: target.text })
  }

  const subtitle = (() => {
    if (!activeConversation) return ''
    if (typingText) return typingText
    if (activeConversation.kind === 'room') {
      return `${directory.filter((u) => u.online).length} 人在线`
    }
    return activeConversation.online ? '在线' : '离线'
  })()

  return (
    <section className="flex min-w-0 flex-1">
      <ConversationList
        items={conversations}
        contacts={contacts}
        chattedUsernames={chattedUsernames}
        memberOnline={memberOnline}
        memberTotal={memberDirectory.length}
        activeKey={activeKey}
        filter={filter}
        onFilterChange={setFilter}
        onSelect={setActiveKey}
        onStartPrivate={handleStartPrivate}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 对话头 */}
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          {activeConversation ? (
            <>
              <Avatar size="default">
                <AvatarFallback
                  className={cn(activeConversation.kind === 'room' && 'bg-primary/15 text-primary')}
                >
                  {avatarMark(activeConversation.avatar, activeConversation.title)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{activeConversation.title}</div>
                <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
              </div>
              {/* 右上仅在「与协作服务器的连接」异常时提示; 正常连接不显示, 避免被误解为对方在线。
                  对话方/房间的真实在线状态见标题下方副标题。 */}
              {connection !== 'online' && (
                <span
                  className={cn(
                    'flex items-center gap-1.5 text-xs',
                    connection === 'closed' || connection === 'error'
                      ? 'text-destructive'
                      : 'text-muted-foreground',
                  )}
                  title="与协作服务器的连接状态"
                >
                  <span
                    className={cn(
                      'size-2 rounded-full',
                      connection === 'closed' || connection === 'error'
                        ? 'bg-destructive'
                        : 'animate-pulse bg-muted-foreground/50',
                    )}
                  />
                  {connectionLabel(connection)}
                </span>
              )}
            </>
          ) : (
            <span className="text-sm text-muted-foreground">协作聊天</span>
          )}
        </div>

        {/* 消息滚动区 */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
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
            <div className="selectable flex flex-col gap-1.5">
              {messages.map((message, i) => {
                const prev = i > 0 ? messages[i - 1] : null
                const showDate = !prev || !isSameDay(prev.timestamp, message.timestamp)
                const mine = !message.system && message.from === selfUsername
                const showAvatar =
                  !mine && (!prev || prev.system || prev.from !== message.from || showDate)
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
                      selfUsername={selfUsername}
                      actions={messageActions}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 输入区 (编辑态用 key 重挂载以 seed 原文) */}
        <Composer
          key={editDraft ? `edit:${editDraft.id}` : `compose:${activeKey}`}
          disabled={!online || !activeConversation}
          placeholder={
            online
              ? activeConversation?.kind === 'private'
                ? `发消息给 ${activeConversation.title}…`
                : '发送到房间…'
              : '登录账户后即可发送消息'
          }
          reply={replyDraft}
          edit={editDraft}
          forward={forwardDraft}
          onSend={handleSend}
          onEditSubmit={handleEditSubmit}
          onCancelDraft={clearDrafts}
          onTyping={(active) => {
            if (!activeConversation) return
            chat.sendTyping(active, scope, activeConversation.username)
          }}
          onArrowUpEmpty={handleArrowUpEdit}
        />
      </div>

      <ImageLightbox target={lightbox} onClose={() => setLightbox(null)} />
    </section>
  )
}

function connectionLabel(state: ReturnType<typeof useChatStore.getState>['connection']): string {
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
