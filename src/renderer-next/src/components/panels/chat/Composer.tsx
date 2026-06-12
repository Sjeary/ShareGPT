import { useEffect, useRef, useState } from 'react'
import { CornerUpLeft, Paperclip, Pencil, SendHorizontal, Share2, Upload, X } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type {
  ChatAttachment,
  ChatEditDraft,
  ChatForwardDraft,
  ChatReplyTarget,
} from '@/store/useChatStore'
import { formatBytes } from './format'

const MAX_BYTES = 30 * 1024 * 1024 // 30MB, 与旧版 CHAT_ATTACHMENT_MAX_BYTES 及服务器约束一致

// 剪贴板兜底描述符 (旧 window.api.readClipboardAttachment 返回结构)。
interface ClipboardAttachmentDescriptor {
  dataUrl?: string
  kind?: string
  name?: string
  mime?: string
  size?: number
  preferredMode?: string
}

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
  onArrowUpEmpty,
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
  // ArrowUp 召回编辑: text 为空且非 edit/forward 态时触发 (旧 ~6077)。
  onArrowUpEmpty?: () => void
}) {
  // 进入编辑态: 以原文懒初始化 (Composer 在 edit.id 变化时由父级 key 重挂载,
  // 故此处一次性 seed 即可, 避免 effect 内 setState) (旧 setEditDraftFromMessage ~4806)。
  const [text, setText] = useState(() => edit?.preview ?? '')
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const dragDepth = useRef(0)
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

  // 由剪贴板描述符落地为附件 (旧 applyPendingAttachmentDescriptor/applyPendingInlineImageDescriptor)。
  function applyDescriptor(descriptor: ClipboardAttachmentDescriptor) {
    const dataUrl = String(descriptor.dataUrl || '')
    if (!dataUrl) return
    const size = Number(descriptor.size) || 0
    if (size > MAX_BYTES) {
      setError(`文件不能超过 ${formatBytes(MAX_BYTES)}。`)
      return
    }
    const isImage =
      descriptor.kind === 'image' ||
      descriptor.preferredMode === 'inline-image'
    setAttachment({
      kind: isImage ? 'image' : 'file',
      name:
        (descriptor.name || '').trim() ||
        (isImage ? 'pasted-image.png' : 'file'),
      mime: (descriptor.mime || '').trim() || (isImage ? 'image/png' : ''),
      size,
      dataUrl,
    })
    setError('')
  }

  // 粘贴: 优先剪贴板里的图片/文件项, 否则走主进程剪贴板兜底 (旧 ~6040)。
  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (inEdit) return
    const items = Array.from(e.clipboardData?.items ?? [])
    const imageItem = items.find((it) => String(it.type || '').startsWith('image/'))
    const fileItem = items.find((it) => it.kind === 'file')
    try {
      if (imageItem || fileItem) {
        const file = imageItem?.getAsFile?.() ?? fileItem?.getAsFile?.()
        if (!file) return
        e.preventDefault()
        await pickFile(file)
        return
      }
      const descriptor = (await api.readClipboardAttachment?.()) as
        | ClipboardAttachmentDescriptor
        | undefined
      if (!descriptor?.dataUrl) return
      e.preventDefault()
      applyDescriptor(descriptor)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '读取剪贴板内容失败',
      )
    }
  }

  function dragHasFiles(e: React.DragEvent): boolean {
    return Array.from(e.dataTransfer?.types ?? []).includes('Files')
  }

  return (
    <div
      className="relative shrink-0 border-t border-border p-3"
      onDragEnter={(e) => {
        if (disabled || inEdit || !dragHasFiles(e)) return
        e.preventDefault()
        dragDepth.current += 1
        setDragOver(true)
      }}
      onDragOver={(e) => {
        if (disabled || inEdit || !dragHasFiles(e)) return
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (!dragHasFiles(e)) return
        e.preventDefault()
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragOver(false)
      }}
      onDrop={(e) => {
        if (disabled || inEdit || !dragHasFiles(e)) return
        e.preventDefault()
        dragDepth.current = 0
        setDragOver(false)
        void pickFile(e.dataTransfer?.files?.[0])
      }}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-1 z-10 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-background/85 text-sm font-medium text-primary">
          <span className="flex items-center gap-2">
            <Upload className="size-5" />
            松开以添加附件
          </span>
        </div>
      )}
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
          onPaste={(e) => void handlePaste(e)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && (reply || edit || forward)) {
              e.preventDefault()
              cancelDraft()
              return
            }
            // ArrowUp 召回编辑: 仅当输入为空、无附件、非 edit/forward 态 (旧 ~6077)。
            if (
              e.key === 'ArrowUp' &&
              !e.shiftKey &&
              !e.altKey &&
              !e.ctrlKey &&
              !e.metaKey &&
              !e.nativeEvent.isComposing &&
              !text &&
              !attachment &&
              !edit &&
              !forward &&
              onArrowUpEmpty
            ) {
              e.preventDefault()
              onArrowUpEmpty()
              return
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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
