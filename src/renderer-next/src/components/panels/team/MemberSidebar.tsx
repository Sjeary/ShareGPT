import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { colorForOrganizer, type TeamEvent } from '@/store/useTeamCalendarStore'

// 成员侧栏 (P1): 列出本房间所有事件的 organizer (按成员色), 可勾选显示/隐藏其事件。
// 同时给出最基础的 free/busy 提示 (该成员事件数)。

interface MemberStat {
  username: string
  displayName: string
  count: number
}

export function MemberSidebar({
  events,
  hiddenOrganizers,
  onToggle,
}: {
  events: TeamEvent[]
  hiddenOrganizers: string[]
  onToggle: (username: string) => void
}) {
  // 按 organizer 聚合。
  const members: MemberStat[] = []
  const seen = new Map<string, MemberStat>()
  for (const e of events) {
    const key = e.organizer || '未知'
    const existing = seen.get(key)
    if (existing) {
      existing.count += 1
    } else {
      const stat: MemberStat = {
        username: key,
        // 尝试用 attendee 里的 displayName 兜底成员展示名。
        displayName: e.attendees.find((a) => a.username === key)?.displayName || key,
        count: 1,
      }
      seen.set(key, stat)
      members.push(stat)
    }
  }
  members.sort((a, b) => b.count - a.count)

  return (
    <aside className="flex w-52 shrink-0 flex-col border-l border-border bg-sidebar/40">
      <div className="border-b border-border px-4 py-3 text-xs font-medium text-muted-foreground">
        成员 ({members.length})
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto p-2">
        {members.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">暂无事件组织者</p>
        ) : (
          members.map((m) => {
            const hidden = hiddenOrganizers.includes(m.username)
            const color = colorForOrganizer(m.username)
            return (
              <button
                key={m.username}
                type="button"
                onClick={() => onToggle(m.username)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
                  hidden && 'opacity-50',
                )}
              >
                <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <span className="min-w-0 flex-1 truncate">{m.displayName}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{m.count}</span>
                {hidden ? (
                  <EyeOff className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <Eye className="size-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}
