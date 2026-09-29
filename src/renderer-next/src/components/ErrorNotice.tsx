import { useState } from 'react'
import { Check, ChevronDown, Copy, TriangleAlert, X } from 'lucide-react'
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
        'flex min-w-0 items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-left text-xs text-muted-foreground',
        className,
      )}
    >
      <details key={notice.details} className="group/notice min-w-0 flex-1">
        <summary className="flex min-h-5 cursor-pointer list-none items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <TriangleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
          <span
            className="min-w-0 flex-1 truncate font-medium text-foreground"
            title={notice.title}
          >
            {notice.title}
          </span>
          <span className="shrink-0 text-muted-foreground group-open/notice:hidden">展开</span>
          <span className="hidden shrink-0 text-muted-foreground group-open/notice:inline">
            收起
          </span>
          <ChevronDown
            className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-open/notice:rotate-180 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </summary>
        <div className="mt-2 space-y-2 border-t border-border/60 pt-2">
          <p className="break-words leading-relaxed text-foreground">{notice.description}</p>
          {notice.suggestion && (
            <p className="break-words leading-relaxed text-muted-foreground">{notice.suggestion}</p>
          )}
          <p className="text-[11px] font-medium text-muted-foreground">技术详情</p>
          <pre className="selectable max-h-36 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border/60 bg-background p-2 text-[11px] text-muted-foreground">
            {notice.details}
          </pre>
          <Button type="button" variant="ghost" size="xs" onClick={() => void copyDetails()}>
            {copied ? <Check /> : <Copy />}
            {copied ? '已复制' : '复制技术详情'}
          </Button>
          {copyFailed && (
            <p role="status" className="text-xs">
              复制失败，请选中上方详情手动复制。
            </p>
          )}
        </div>
      </details>
      {onDismiss && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          <X />
        </Button>
      )}
    </div>
  )
}
