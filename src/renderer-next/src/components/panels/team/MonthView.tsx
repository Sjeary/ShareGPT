import { cn } from '@/lib/utils'
import { colorForOrganizer, type TeamEvent } from '@/store/useTeamCalendarStore'
import { WEEKDAY_LABELS, eventOccursOnDay, fmtDayNumber, fmtTime, isSameDay } from './calendarUtils'

// 月视图: 6*7 网格, 每格列出当天事件 (最多 3 条 + “+N”)。
// 事件颜色优先取 event.color, 否则按 organizer 生成成员色。

function eventColor(event: TeamEvent): string {
  return event.color || colorForOrganizer(event.organizer)
}

export function MonthView({
  days,
  anchorMonth,
  events,
  onSelectEvent,
  onSelectDay,
}: {
  days: Date[]
  anchorMonth: number // 0-11, 用于淡化非本月日期
  events: TeamEvent[]
  onSelectEvent: (event: TeamEvent) => void
  onSelectDay: (day: Date) => void
}) {
  const today = new Date()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 星期表头 */}
      <div className="grid shrink-0 grid-cols-7 border-b border-border">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="px-2 py-2.5 text-center text-sm font-medium text-muted-foreground"
          >
            周{label}
          </div>
        ))}
      </div>

      {/* 日期网格 */}
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7">
        {days.map((day) => {
          const inMonth = day.getMonth() === anchorMonth
          const isToday = isSameDay(day, today)
          const dayEvents = events.filter((e) => eventOccursOnDay(e, day))
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelectDay(day)}
              className={cn(
                'flex min-h-[88px] flex-col gap-1 border-r border-b border-border p-1.5 text-left transition-colors hover:bg-accent/50',
                !inMonth && 'bg-muted/30 text-muted-foreground',
              )}
            >
              <div className="flex items-center justify-between px-1">
                <span
                  className={cn(
                    'flex size-6 items-center justify-center rounded-full text-sm',
                    isToday && 'bg-primary font-semibold text-primary-foreground',
                  )}
                >
                  {fmtDayNumber(day)}
                </span>
              </div>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {dayEvents.slice(0, 3).map((e) => (
                  <span
                    key={e.id}
                    role="button"
                    tabIndex={0}
                    onClick={(ev) => {
                      ev.stopPropagation()
                      onSelectEvent(e)
                    }}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') {
                        ev.stopPropagation()
                        onSelectEvent(e)
                      }
                    }}
                    className="flex items-center gap-1 truncate rounded px-1.5 py-1 text-sm leading-tight text-foreground hover:opacity-80"
                    style={{ backgroundColor: `${eventColor(e)}22` }}
                  >
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: eventColor(e) }}
                    />
                    {!e.allDay && (
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {fmtTime(e.start)}
                      </span>
                    )}
                    <span className="truncate">{e.title}</span>
                  </span>
                ))}
                {dayEvents.length > 3 && (
                  <span className="px-1 text-xs text-muted-foreground">
                    +{dayEvents.length - 3} 更多
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
