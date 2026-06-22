import { cn } from '@/lib/utils'
import { colorForOrganizer, type TeamEvent } from '@/store/useTeamCalendarStore'
import { WEEKDAY_LABELS, eventOccursOnDay, fmtTime, format, isSameDay } from './calendarUtils'

// 周视图: 7 列 (周一~周日), 每列纵向列出当天事件。顶部显示日期, 当天高亮。
// 简化版 (非按小时刻度的时间轴), 聚焦“团队这一周有什么/谁忙”。

function eventColor(event: TeamEvent): string {
  return event.color || colorForOrganizer(event.organizer)
}

export function WeekView({
  days,
  events,
  onSelectEvent,
  onSelectDay,
}: {
  days: Date[]
  events: TeamEvent[]
  onSelectEvent: (event: TeamEvent) => void
  onSelectDay: (day: Date) => void
}) {
  const today = new Date()

  return (
    <div className="grid min-h-0 flex-1 grid-cols-7">
      {days.map((day, i) => {
        const isToday = isSameDay(day, today)
        const dayEvents = events
          .filter((e) => eventOccursOnDay(e, day))
          .sort((a, b) => a.start.localeCompare(b.start))
        return (
          <div key={day.toISOString()} className="flex min-h-0 flex-col border-r border-border">
            <button
              type="button"
              onClick={() => onSelectDay(day)}
              className={cn(
                'flex shrink-0 flex-col items-center gap-0.5 border-b border-border py-2 transition-colors hover:bg-accent/50',
                isToday && 'bg-primary/5',
              )}
            >
              <span className="text-sm text-muted-foreground">周{WEEKDAY_LABELS[i]}</span>
              <span
                className={cn(
                  'flex size-7 items-center justify-center rounded-full text-base',
                  isToday && 'bg-primary font-semibold text-primary-foreground',
                )}
              >
                {format(day, 'd')}
              </span>
              {/* free/busy 提示: 当天有事件则显示忙碌点 */}
              {dayEvents.length > 0 && (
                <span className="text-xs text-muted-foreground">{dayEvents.length} 项</span>
              )}
            </button>

            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto p-1.5">
              {dayEvents.length === 0 ? (
                <div className="px-1 pt-2 text-center text-xs text-muted-foreground/60">空闲</div>
              ) : (
                dayEvents.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onSelectEvent(e)}
                    className="flex flex-col gap-0.5 rounded-md border-l-2 px-2 py-1.5 text-left transition-colors hover:opacity-80"
                    style={{
                      borderLeftColor: eventColor(e),
                      backgroundColor: `${eventColor(e)}14`,
                    }}
                  >
                    <span className="truncate text-sm font-medium leading-tight">{e.title}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {e.allDay ? '全天' : `${fmtTime(e.start)}–${fmtTime(e.end)}`}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
