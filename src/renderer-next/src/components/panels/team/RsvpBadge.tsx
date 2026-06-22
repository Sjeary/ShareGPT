import { Check, HelpCircle, X, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RsvpStatus } from '@/store/useTeamCalendarStore'

// RSVP 状态徽章 (对齐飞书): 绿=接受, 红=拒绝, 黄=待定, 灰=未响应。
// 用纯 Tailwind 上色 (不依赖 badge variant), 以便 light/dark 都清晰。

const RSVP_META: Record<RsvpStatus, { label: string; icon: typeof Check; className: string }> = {
  accept: {
    label: '接受',
    icon: Check,
    className:
      'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400 border-green-200 dark:border-green-500/30',
  },
  decline: {
    label: '拒绝',
    icon: X,
    className:
      'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400 border-red-200 dark:border-red-500/30',
  },
  tentative: {
    label: '待定',
    icon: Clock,
    className:
      'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-200 dark:border-amber-500/30',
  },
  needs_action: {
    label: '未响应',
    icon: HelpCircle,
    className: 'bg-muted text-muted-foreground border-border',
  },
}

export function RsvpBadge({
  status,
  className,
  showIcon = true,
}: {
  status: RsvpStatus
  className?: string
  showIcon?: boolean
}) {
  const meta = RSVP_META[status] ?? RSVP_META.needs_action
  const Icon = meta.icon
  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-medium whitespace-nowrap',
        meta.className,
        className,
      )}
    >
      {showIcon && <Icon className="size-3.5" />}
      {meta.label}
    </span>
  )
}
