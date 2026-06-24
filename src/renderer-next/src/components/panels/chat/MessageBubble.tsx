import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  CornerUpLeft,
  FileText,
  MoreHorizontal,
  Pencil,
  Share2,
  SmilePlus,
  Trash2,
} from 'lucide-react'
import { Theme, EmojiStyle, type EmojiClickData } from 'emoji-picker-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { emojiClusters, JUMBO_MAX } from '@/lib/chat/emoji'
import { useAppStore } from '@/store/useAppStore'
import type { ChatAttachment, ChatMessage } from '@/store/useChatStore'
import { JumboEmoji } from './JumboEmoji'

// 表情选择器较重, 懒加载; 用 NATIVE(unicode) 风格, 离线也能显示。
const EmojiPicker = lazy(() => import('emoji-picker-react'))
import { avatarMark, formatBytes, formatMessageTime, formatSmartTime } from './format'
import {
  buildMessageLinkPreview,
  extractFirstUrl,
  openMessageUrl,
  renderMessageRichText,
} from './richText'

function AttachmentView({
  att,
  onOpenImage,
}: {
  att: ChatAttachment
  onOpenImage: (dataUrl: string, alt: string) => void
}) {
  if (att.kind === 'image') {
    return (
      <button
        type="button"
        aria-label={att.name || '查看图片'}
        onClick={() => onOpenImage(att.dataUrl, att.name || '聊天图片')}
        className="mt-1 block overflow-hidden rounded-lg"
      >
        <img
          src={att.dataUrl}
          alt={att.name}
          className="max-h-60 max-w-full cursor-zoom-in object-contain"
        />
      </button>
    )
  }
  return (
    <a
      href={att.dataUrl}
      download={att.name}
      className="mt-1 flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2 text-sm hover:bg-background/70"
    >
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{att.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(att.size)}</span>
    </a>
  )
}

export interface MessageActions {
  onReply: (message: ChatMessage) => void
  onForward: (message: ChatMessage) => void
  onEdit: (message: ChatMessage) => void
  onRecall: (message: ChatMessage) => void
  onReact: (message: ChatMessage, emoji: string) => void
  onOpenImage: (dataUrl: string, alt: string) => void
  onJumpToMessage: (id: string) => void
}

// 单条气泡: 系统消息居中; 自己消息右对齐主色气泡; 他人左对齐+头像。
// 悬浮露出「⋯」菜单, 提供 回复 / 转发 / 编辑(自己且纯文本) / 撤回(自己)。
export function MessageBubble({
  message,
  mine,
  showAvatar,
  selfUsername,
  actions,
}: {
  message: ChatMessage
  mine: boolean
  showAvatar: boolean
  selfUsername: string
  actions: MessageActions
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmRecall, setConfirmRecall] = useState(false)
  const [readersOpen, setReadersOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const readersRef = useRef<HTMLDivElement>(null)
  const dark = useAppStore((s) => s.dark)

  useEffect(() => {
    if (!menuOpen && !pickerOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setPickerOpen(false)
        setConfirmRecall(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen, pickerOpen])

  useEffect(() => {
    if (!readersOpen) return
    const onDown = (e: MouseEvent) => {
      if (readersRef.current && !readersRef.current.contains(e.target as Node)) {
        setReadersOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [readersOpen])

  if (message.system) {
    return (
      <div className="my-1 flex justify-center">
        <span className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
          {message.text}
        </span>
      </div>
    )
  }

  const canAct = Boolean(message.id) && !message.recalled
  const canEdit = canAct && mine && Boolean(message.text) && message.attachments.length === 0

  const menuItems: {
    label: string
    icon: typeof CornerUpLeft
    run: () => void
    danger?: boolean
  }[] = []
  if (canAct) {
    menuItems.push({
      label: '回复',
      icon: CornerUpLeft,
      run: () => actions.onReply(message),
    })
    menuItems.push({
      label: '转发',
      icon: Share2,
      run: () => actions.onForward(message),
    })
    if (canEdit) {
      menuItems.push({
        label: '编辑',
        icon: Pencil,
        run: () => actions.onEdit(message),
      })
    }
    if (mine) {
      menuItems.push({
        label: '撤回',
        icon: Trash2,
        run: () => actions.onRecall(message),
        danger: true,
      })
    }
  }

  function openContextMenu(e: React.MouseEvent) {
    if (!menuItems.length) return
    e.preventDefault()
    setMenuOpen(true)
  }

  // 群聊已读: 排除自己后的已读者 (旧 ~3870)。
  const readByOthers =
    mine && message.scope === 'subnet' && !message.recalled
      ? message.readBy.filter((r) => r.username !== selfUsername)
      : []
  const readNames = readByOthers.map((r) => r.displayName || r.username)
  const readSummary =
    readNames.length <= 3
      ? readNames.join('、')
      : `${readNames.slice(0, 3).join('、')} 等${readNames.length}人`

  // 正文富文本 + 首个 URL 链接预览卡。
  const richBody = message.text ? renderMessageRichText(message.text) : null
  const linkPreview = message.text ? buildMessageLinkPreview(extractFirstUrl(message.text)) : null

  // 纯 emoji 消息 (≤3 个) → 放大 / 动态 / 两个组合 (Telegram 式)。
  const jumbo =
    !message.recalled && message.text && message.attachments.length === 0
      ? emojiClusters(message.text)
      : null
  const jumboList = jumbo && jumbo.length <= JUMBO_MAX ? jumbo : null
  // 纯表情且无引用/转发/链接卡时, 去掉气泡底色, 仅显示放大表情 (更像 Telegram)。
  const bareJumbo = Boolean(jumboList && !message.replyTo && !message.forwardedFrom && !linkPreview)

  return (
    <div
      data-message-id={message.id || undefined}
      className={cn(
        'group/bubble relative flex w-full gap-2 transition-colors',
        mine ? 'flex-row-reverse' : 'flex-row',
        // 跳转高亮 (旧 chat-item-targeted)。
        'rounded-xl [&.chat-jump-target]:bg-primary/10',
      )}
      onContextMenu={openContextMenu}
    >
      {!mine ? (
        <div className="w-8 shrink-0">
          {showAvatar && (
            <Avatar size="default">
              {message.avatar && /^https?:|^data:/.test(message.avatar) && (
                <AvatarImage src={message.avatar} alt={message.displayName} />
              )}
              <AvatarFallback>{avatarMark(message.avatar, message.displayName)}</AvatarFallback>
            </Avatar>
          )}
        </div>
      ) : null}

      <div className={cn('flex max-w-[72%] flex-col gap-0.5', mine ? 'items-end' : 'items-start')}>
        {!mine && showAvatar && (
          <span className="px-1 text-xs font-medium text-muted-foreground">
            {message.displayName}
          </span>
        )}

        <div className="relative">
          <div
            className={cn(
              'rounded-2xl px-3 py-2 text-sm break-words [overflow-wrap:anywhere]',
              bareJumbo
                ? 'bg-transparent px-0 py-0' // 纯表情: 去气泡底色, 只显示放大表情
                : mine
                  ? 'rounded-br-md bg-primary text-primary-foreground'
                  : 'rounded-bl-md bg-secondary text-secondary-foreground',
            )}
          >
            {!message.recalled && message.replyTo && (
              <button
                type="button"
                onClick={() => actions.onJumpToMessage(message.replyTo!.id)}
                className={cn(
                  'mb-1 flex w-full flex-col items-start gap-0 rounded-md border-l-2 px-2 py-1 text-left text-xs transition-colors',
                  mine
                    ? 'border-primary-foreground/50 bg-primary-foreground/10 hover:bg-primary-foreground/20'
                    : 'border-primary/50 bg-background/40 hover:bg-background/60',
                )}
              >
                <span className="max-w-full truncate font-medium">
                  {message.replyTo.displayName || message.replyTo.from || '消息'}
                </span>
                <span className="max-w-full truncate opacity-80">{message.replyTo.preview}</span>
              </button>
            )}

            {message.forwardedFrom && (
              <div className="mb-1 text-xs opacity-70">
                转发自 {message.forwardedFrom.displayName}
              </div>
            )}

            {message.recalled ? (
              <span className="italic opacity-70">
                {mine ? '你撤回了一条消息' : `${message.displayName} 撤回了一条消息`}
              </span>
            ) : (
              <>
                {jumboList ? (
                  <JumboEmoji clusters={jumboList} />
                ) : (
                  richBody && (
                    <div className="selectable whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {richBody}
                    </div>
                  )
                )}
                {linkPreview && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      openMessageUrl(linkPreview.url)
                    }}
                    className="mt-1.5 flex w-full min-w-0 flex-col items-start gap-0.5 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-left text-xs transition-colors hover:bg-background/70"
                  >
                    <strong className="max-w-full truncate font-medium">{linkPreview.host}</strong>
                    <span className="max-w-full truncate text-muted-foreground [overflow-wrap:anywhere]">
                      {linkPreview.url}
                    </span>
                  </button>
                )}
                {message.attachments.map((att, i) => (
                  <AttachmentView key={i} att={att} onOpenImage={actions.onOpenImage} />
                ))}
              </>
            )}
          </div>

          {menuItems.length > 0 && (
            <div
              ref={menuRef}
              className={cn(
                'absolute top-0 z-10 flex gap-0.5',
                mine ? 'left-0 -translate-x-full pr-1' : 'right-0 translate-x-full pl-1',
              )}
            >
              <button
                type="button"
                aria-label="表情回应"
                onClick={() => {
                  setPickerOpen((v) => !v)
                  setMenuOpen(false)
                }}
                className={cn(
                  'grid size-6 place-items-center rounded-full bg-secondary text-muted-foreground opacity-0 outline-none transition-opacity hover:text-foreground',
                  'group-hover/bubble:opacity-100 group-focus-within/bubble:opacity-100',
                  'focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring',
                  pickerOpen && 'opacity-100',
                )}
              >
                <SmilePlus className="size-4" />
              </button>
              {pickerOpen && (
                // 朝「内侧」展开 (我的消息工具条在右 → 向左展开; 对方在左 → 向右展开),
                // 避免 300px 面板越过视口边缘把整页撑出横向滚动。
                <div className={cn('absolute top-7 z-30', mine ? 'right-0' : 'left-0')}>
                  <Suspense
                    fallback={
                      <div className="rounded-lg border border-border bg-popover p-4 text-xs text-muted-foreground shadow-md">
                        加载表情…
                      </div>
                    }
                  >
                    <EmojiPicker
                      onEmojiClick={(e: EmojiClickData) => {
                        actions.onReact(message, e.emoji)
                        setPickerOpen(false)
                      }}
                      theme={dark ? Theme.DARK : Theme.LIGHT}
                      emojiStyle={EmojiStyle.NATIVE}
                      lazyLoadEmojis
                      width={300}
                      height={380}
                    />
                  </Suspense>
                </div>
              )}
              <button
                type="button"
                aria-label="消息操作"
                onClick={() => {
                  setMenuOpen((v) => !v)
                  setPickerOpen(false)
                  setConfirmRecall(false)
                }}
                className={cn(
                  'grid size-6 place-items-center rounded-full bg-secondary text-muted-foreground opacity-0 outline-none transition-opacity hover:text-foreground',
                  'group-hover/bubble:opacity-100 group-focus-within/bubble:opacity-100',
                  'focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring',
                  menuOpen && 'opacity-100',
                )}
              >
                <MoreHorizontal className="size-4" />
              </button>
              {menuOpen && (
                <div
                  className={cn(
                    'absolute top-7 z-20 min-w-32 origin-top overflow-hidden rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-md',
                    'animate-in fade-in zoom-in-95',
                    mine ? 'left-0' : 'right-0',
                  )}
                >
                  {menuItems.map((item) => {
                    const needsConfirm = item.danger && !confirmRecall
                    return (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => {
                          if (needsConfirm) {
                            setConfirmRecall(true)
                            return
                          }
                          setMenuOpen(false)
                          setConfirmRecall(false)
                          item.run()
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent',
                          item.danger && 'text-destructive',
                        )}
                      >
                        <item.icon
                          className={cn(
                            'size-4',
                            item.danger ? 'text-destructive' : 'text-muted-foreground',
                          )}
                        />
                        {item.danger && confirmRecall ? '确认撤回？' : item.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {!message.recalled && Object.keys(message.reactions ?? {}).length > 0 && (
          <div className={cn('flex flex-wrap gap-1 px-1', mine ? 'justify-end' : 'justify-start')}>
            {Object.entries(message.reactions).map(([emoji, users]) => {
              const reacted = users.includes(selfUsername)
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => actions.onReact(message, emoji)}
                  title={users.join('、')}
                  className={cn(
                    'inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs transition-colors animate-in zoom-in-95',
                    reacted
                      ? 'border-primary/50 bg-primary/15 text-primary'
                      : 'border-border bg-secondary hover:bg-accent',
                  )}
                >
                  <span>{emoji}</span>
                  <span className="tabular-nums">{users.length}</span>
                </button>
              )
            })}
          </div>
        )}

        <span
          className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground"
          title={readByOthers.length ? `已读：${readSummary}` : undefined}
        >
          {formatMessageTime(message.timestamp)}
          {message.edited && !message.recalled ? ' · 已编辑' : ''}
          {message.recalled ? ' · 已撤回' : ''}
          {/* 已读回执: 仅自己消息 */}
          {mine && !message.recalled && message.scope === 'private' && (
            <span className={cn(message.readAt ? 'text-primary' : '')}>
              {message.readAt ? '✓✓' : '✓'}
            </span>
          )}
          {mine && readByOthers.length > 0 && (
            <span ref={readersRef} className="relative inline-flex">
              <button
                type="button"
                onClick={() => setReadersOpen((v) => !v)}
                className="text-primary outline-none hover:underline focus-visible:underline"
              >
                {readByOthers.length} 人已读
              </button>
              {readersOpen && (
                <div
                  className={cn(
                    'no-scrollbar absolute bottom-full z-30 mb-1 max-h-56 w-48 overflow-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md',
                    'animate-in fade-in zoom-in-95',
                    mine ? 'right-0' : 'left-0',
                  )}
                >
                  <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                    已读 · {readByOthers.length} 人
                  </div>
                  {readByOthers.map((r) => (
                    <div key={r.username} className="flex items-center gap-2 rounded-md px-2 py-1">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-[10px] text-muted-foreground">
                        {avatarMark('', r.displayName || r.username)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                        {r.displayName || r.username}
                      </span>
                      {r.readAt && (
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {formatSmartTime(r.readAt)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </span>
          )}
        </span>
      </div>
    </div>
  )
}
