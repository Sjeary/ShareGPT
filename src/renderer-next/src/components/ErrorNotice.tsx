import { useState } from 'react'
import { Check, Copy, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { describeUserError } from '@/lib/userFacingError'
import { cn } from '@/lib/utils'

export function ErrorNotice({
  error,
  context,
  className,
  onDismiss,
  dismissLabel = '关闭提示',
}: {
  error: unknown
  context: string
  className?: string
  onDismiss?: () => void
  dismissLabel?: string
}) {
  const notice = describeUserError(error, context)
  const [copiedDetails, setCopiedDetails] = useState('')
  const [failedDetails, setFailedDetails] = useState('')
  const copyFailed = failedDetails === notice.details
  const copied = copiedDetails === notice.details
  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(notice.details)
      setCopiedDetails(notice.details)
      setFailedDetails('')
    } catch {
      setFailedDetails(notice.details)
    }
  }
  return (
    <div
      role="alert"
      aria-label={`${context}错误`}
      data-error-category={notice.category}
      className={cn(
        'min-w-0 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-left text-xs',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1 break-words">
          <p className="font-medium text-destructive">{notice.title}</p>
          <p className="leading-relaxed text-foreground">{notice.description}</p>
          {notice.suggestion && (
            <p className="leading-relaxed text-muted-foreground">{notice.suggestion}</p>
          )}
        </div>
        {onDismiss && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            aria-label={dismissLabel}
            onClick={onDismiss}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
      <details className="mt-2 min-w-0 text-muted-foreground">
        <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          查看技术详情
        </summary>
        <pre className="selectable mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-all rounded bg-background/70 p-2 text-[11px]">
          {notice.details}
        </pre>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 h-7 text-xs"
          onClick={() => void copyDetails()}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? '已复制' : '复制技术详情'}
        </Button>
        {copyFailed && (
          <p role="status" className="mt-1 text-xs">
            复制失败，请选中上方详情手动复制。
          </p>
        )}
      </details>
    </div>
  )
}
