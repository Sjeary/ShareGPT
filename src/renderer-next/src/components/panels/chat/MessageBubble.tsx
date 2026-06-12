import { CornerUpLeft, FileText } from 'lucide-react'
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

// 单条气泡: 系统消息居中; 自己消息右对齐琥珀气泡; 他人左对齐+头像。
export function MessageBubble({
  message,
  mine,
  showAvatar,
}: {
  message: ChatMessage
  mine: boolean
  showAvatar: boolean
}) {
  if (message.system) {
    return (
      <div className="my-1 flex justify-center">
        <span className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
          {message.text}
        </span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex w-full gap-2',
        mine ? 'flex-row-reverse' : 'flex-row',
      )}
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

        <span className="px-1 text-[11px] text-muted-foreground">
          {formatMessageTime(message.timestamp)}
          {message.edited && !message.recalled ? ' · 已编辑' : ''}
        </span>
      </div>
    </div>
  )
}
