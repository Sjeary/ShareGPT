import { useEffect, useRef, useState } from 'react'
import { CornerUpLeft, Paperclip, Pencil, SendHorizontal, Share2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type {
  ChatAttachment,
  ChatEditDraft,
  ChatForwardDraft,
  ChatReplyTarget,
} from '@/store/useChatStore'
import { formatBytes } from './format'

const MAX_BYTES = 8 * 1024 * 1024 // 8MB, 与旧版 CHAT_ATTACHMENT_MAX_BYTES 同量级

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

// 顶部草稿条 (回复/编辑/转发) (移植自旧 renderReplyDraft/renderEditDraft/renderForwardDraft ~4711)。
function DraftBar({
  reply,
  edit,
  forward,
  onCancel,
}: {
  reply: ChatReplyTarget | null
  edit: ChatEditDraft | null
  forward: ChatForwardDraft | null
  onCancel: () => void
}) {
  let Icon = CornerUpLeft
  let title: string
  let preview: string
  if (edit) {
    Icon = Pencil
    title = '编辑消息'
    preview = edit.preview || '原消息'
  } else if (forward) {
    Icon = Share2
    title = `转发自 ${forward.displayName || forward.from || '消息'}`
    preview = forward.preview || '转发消息'
  } else if (reply) {
    title = `回复 ${reply.displayName}`
    preview = reply.preview || '原消息'
  } else {
    return null
  }
  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg border-l-2 border-primary bg-secondary px-3 py-2 text-sm">
      <Icon className="size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{preview}</div>
      </div>
      <Button type="button" variant="ghost" size="icon-sm" onClick={onCancel}>
        <X className="size-4" />
      </Button>
    </div>
  )
}

// 底部输入区: 草稿条 + 附件 + 文本框 + 发送。
export function Composer({
  disabled,
  placeholder,
  reply,
  edit,
  forward,
  onSend,
  onEditSubmit,
  onCancelDraft,
  onTyping,
}: {
  disabled: boolean
  placeholder: string
  reply: ChatReplyTarget | null
  edit: ChatEditDraft | null
  forward: ChatForwardDraft | null
  onSend: (text: string, attachments: ChatAttachment[]) => void
  onEditSubmit: (id: string, text: string) => void
  onCancelDraft: () => void
  onTyping?: (active: boolean) => void
}) {
  // 进入编辑态: 以原文懒初始化 (Composer 在 edit.id 变化时由父级 key 重挂载,
  // 故此处一次性 seed 即可, 避免 effect 内 setState) (旧 setEditDraftFromMessage ~4806)。
  const [text, setText] = useState(() => edit?.preview ?? '')
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const inEdit = Boolean(edit?.id)

  // 编辑态挂载后: 聚焦并把光标移到末尾。
  useEffect(() => {
    if (!inEdit) return
    const node = textRef.current
    if (node) {
      node.focus()
      node.setSelectionRange(node.value.length, node.value.length)
      node.style.height = 'auto'
      node.style.height = `${Math.min(140, node.scrollHeight)}px`
    }
  }, [inEdit])
  const canSend = !disabled && (text.trim().length > 0 || (!inEdit && attachment !== null))

  function submit() {
    if (!canSend) return
    if (inEdit && edit) {
      onEditSubmit(edit.id, text.trim())
    } else {
      onSend(text.trim(), attachment ? [attachment] : [])
    }
    setText('')
    setAttachment(null)
    setError('')
    onTyping?.(false)
    if (textRef.current) textRef.current.style.height = 'auto'
  }

  function cancelDraft() {
    onCancelDraft()
    if (inEdit) {
      setText('')
      if (textRef.current) textRef.current.style.height = 'auto'
    }
  }

  async function pickFile(file: File | undefined) {
    if (!file) return
    if (file.size > MAX_BYTES) {
      setError(`文件不能超过 ${formatBytes(MAX_BYTES)}。`)
      return
    }
    try {
      const dataUrl = await readFileAsDataUrl(file)
      setAttachment({
        kind: file.type.startsWith('image/') ? 'image' : 'file',
        name: file.name || 'file',
        mime: file.type || '',
        size: file.size || 0,
        dataUrl,
      })
      setError('')
    } catch {
      setError('读取文件失败。')
    }
  }

  return (
    <div className="shrink-0 border-t border-border p-3">
      {error && (
        <div className="mb-2 text-xs text-destructive">{error}</div>
      )}

      <DraftBar
        reply={reply}
        edit={edit}
        forward={forward}
        onCancel={cancelDraft}
      />

      {attachment && !inEdit && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-sm">
          {attachment.kind === 'image' ? (
            <img
              src={attachment.dataUrl}
              alt={attachment.name}
              className="size-9 rounded object-cover"
            />
          ) : (
            <Paperclip className="size-4 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatBytes(attachment.size)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setAttachment(null)}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            void pickFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled || inEdit}
          onClick={() => fileRef.current?.click()}
          title="添加附件"
        >
          <Paperclip className="size-5" />
        </Button>

        <textarea
          ref={textRef}
          value={text}
          disabled={disabled}
          placeholder={inEdit ? '编辑消息…' : placeholder}
          rows={1}
          onChange={(e) => {
            setText(e.target.value)
            if (!inEdit) onTyping?.(e.target.value.trim().length > 0)
            const node = e.target
            node.style.height = 'auto'
            node.style.height = `${Math.min(140, node.scrollHeight)}px`
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && (reply || edit || forward)) {
              e.preventDefault()
              cancelDraft()
              return
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          className={cn(
            'max-h-36 min-h-9 flex-1 resize-none rounded-2xl border border-input bg-background px-3 py-2 text-sm outline-none',
            'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        />

        <Button
          type="button"
          size="icon"
          disabled={!canSend}
          onClick={submit}
          title="发送 (Enter)"
        >
          <SendHorizontal className="size-5" />
        </Button>
      </div>
    </div>
  )
}
