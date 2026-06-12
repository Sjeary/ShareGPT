import { useEffect, useRef, useState } from 'react'
import {
  CornerUpLeft,
  FileText,
  MoreHorizontal,
  Pencil,
  Share2,
  Trash2,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { ChatAttachment, ChatMessage } from '@/store/useChatStore'
import { avatarMark, formatBytes, formatMessageTime } from './format'

function AttachmentView({ att }: { att: ChatAttachment }) {
  if (att.kind === 'image') {
    return (
      <img
        src={att.dataUrl}
        alt={att.name}
        className="mt-1 max-h-60 max-w-full rounded-lg object-contain"
      />
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
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatBytes(att.size)}
      </span>
    </a>
  )
}

export interface MessageActions {
  onReply: (message: ChatMessage) => void
  onForward: (message: ChatMessage) => void
  onEdit: (message: ChatMessage) => void
  onRecall: (message: ChatMessage) => void
}

// 单条气泡: 系统消息居中; 自己消息右对齐主色气泡; 他人左对齐+头像。
// 悬浮露出「⋯」菜单, 提供 回复 / 转发 / 编辑(自己且纯文本) / 撤回(自己)。
export function MessageBubble({
  message,
  mine,
  showAvatar,
  actions,
}: {
  message: ChatMessage
  mine: boolean
  showAvatar: boolean
  actions: MessageActions
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

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
  const canEdit =
    canAct && mine && Boolean(message.text) && message.attachments.length === 0

  const menuItems: { label: string; icon: typeof CornerUpLeft; run: () => void }[] = []
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
      })
    }
  }

  function openContextMenu(e: React.MouseEvent) {
    if (!menuItems.length) return
    e.preventDefault()
    setMenuOpen(true)
  }

  return (
    <div
      className={cn(
        'group/bubble relative flex w-full gap-2',
        mine ? 'flex-row-reverse' : 'flex-row',
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
              <AvatarFallback>
                {avatarMark(message.avatar, message.displayName)}
              </AvatarFallback>
            </Avatar>
          )}
        </div>
      ) : null}

      <div
        className={cn(
          'flex max-w-[72%] flex-col gap-0.5',
          mine ? 'items-end' : 'items-start',
        )}
      >
        {!mine && showAvatar && (
          <span className="px-1 text-xs font-medium text-muted-foreground">
            {message.displayName}
          </span>
        )}

        <div className="relative">
          <div
            className={cn(
              'rounded-2xl px-3 py-2 text-sm break-words',
              mine
                ? 'rounded-br-md bg-primary text-primary-foreground'
                : 'rounded-bl-md bg-secondary text-secondary-foreground',
            )}
          >
            {message.replyTo && (
              <div
                className={cn(
                  'mb-1 flex items-center gap-1 rounded-md border-l-2 px-2 py-1 text-xs',
                  mine
                    ? 'border-primary-foreground/50 bg-primary-foreground/10'
                    : 'border-primary/50 bg-background/40',
                )}
              >
                <CornerUpLeft className="size-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate opacity-80">
                  {message.replyTo.preview}
                </span>
              </div>
            )}

            {message.forwardedFrom && (
              <div className="mb-1 text-xs opacity-70">
                转发自 {message.forwardedFrom.displayName}
              </div>
            )}

            {message.recalled ? (
              <span className="italic opacity-70">[已撤回]</span>
            ) : (
              <>
                {message.text && (
                  <span className="whitespace-pre-wrap">{message.text}</span>
                )}
                {message.attachments.map((att, i) => (
                  <AttachmentView key={i} att={att} />
                ))}
              </>
            )}
          </div>

          {menuItems.length > 0 && (
            <div
              ref={menuRef}
              className={cn(
                'absolute top-0 z-10',
                mine ? 'left-0 -translate-x-full pr-1' : 'right-0 translate-x-full pl-1',
              )}
            >
              <button
                type="button"
                aria-label="消息操作"
                onClick={() => setMenuOpen((v) => !v)}
                className={cn(
                  'grid size-6 place-items-center rounded-full bg-secondary text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/bubble:opacity-100',
                  menuOpen && 'opacity-100',
                )}
              >
                <MoreHorizontal className="size-4" />
              </button>
              {menuOpen && (
                <div
                  className={cn(
                    'absolute top-7 z-20 min-w-32 overflow-hidden rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-md',
                    mine ? 'left-0' : 'right-0',
                  )}
                >
                  {menuItems.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        setMenuOpen(false)
                        item.run()
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <item.icon className="size-4 text-muted-foreground" />
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <span className="px-1 text-[11px] text-muted-foreground">
          {formatMessageTime(message.timestamp)}
          {message.edited && !message.recalled ? ' · 已编辑' : ''}
        </span>
      </div>
    </div>
  )
}
