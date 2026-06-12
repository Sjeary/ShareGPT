import { useRef, useState } from 'react'
import { Paperclip, SendHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ChatAttachment } from '@/store/useChatStore'
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

// 底部输入区: 附件 + 文本框 + 发送。
export function Composer({
  disabled,
  placeholder,
  onSend,
  onTyping,
}: {
  disabled: boolean
  placeholder: string
  onSend: (text: string, attachments: ChatAttachment[]) => void
  onTyping?: (active: boolean) => void
}) {
  const [text, setText] = useState('')
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const canSend = !disabled && (text.trim().length > 0 || attachment !== null)

  function submit() {
    if (!canSend) return
    onSend(text.trim(), attachment ? [attachment] : [])
    setText('')
    setAttachment(null)
    setError('')
    onTyping?.(false)
    if (textRef.current) textRef.current.style.height = 'auto'
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

      {attachment && (
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
          disabled={disabled}
          onClick={() => fileRef.current?.click()}
          title="添加附件"
        >
          <Paperclip className="size-5" />
        </Button>

        <textarea
          ref={textRef}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          onChange={(e) => {
            setText(e.target.value)
            onTyping?.(e.target.value.trim().length > 0)
            const node = e.target
            node.style.height = 'auto'
            node.style.height = `${Math.min(140, node.scrollHeight)}px`
          }}
          onKeyDown={(e) => {
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
