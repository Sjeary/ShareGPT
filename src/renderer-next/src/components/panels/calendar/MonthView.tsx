import { useMemo } from 'react'
import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { cn } from '@/lib/utils'
import { useCalendarStore } from '@/store/useCalendarStore'
import { expandEvents, type EventOccurrence } from '@/lib/recurrence'
import { WEEKDAY_LABELS, hexToRgba, calendarOf, FALLBACK_COLOR } from './helpers'

const WEEK_OPTS = { weekStartsOn: 1 } as const // 周一为首

// 月视图: 6 行 7 列。表头周一..周日, 当天日期着色圆点, 非本月暗淡, 事件用色块 chip。
export function MonthView({
  cursor,
  onPickDay,
  onPickEvent,
}: {
  cursor: Date
  // 点击空白日 -> 在该日新建。
  onPickDay: (day: Date) => void
  // 点击事件 -> 编辑。
  onPickEvent: (eventId: string) => void
}) {
  const calendars = useCalendarStore((s) => s.calendars)
  const events = useCalendarStore((s) => s.events)

  // 可见日历集合。
  const visibleIds = useMemo(
    () => new Set(calendars.filter((c) => c.visible).map((c) => c.id)),
    [calendars],
  )

  // 网格起止 (本月第一周的周一 ~ 末周的周日)。
  const gridStart = startOfWeek(startOfMonth(cursor), WEEK_OPTS)
  const gridEnd = endOfWeek(endOfMonth(cursor), WEEK_OPTS)
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  // 展开重复事件到网格区间, 仅保留可见日历。
  const occurrences = useMemo(() => {
    const visible = events.filter((e) => visibleIds.has(e.calendarId))
    return expandEvents(visible, gridStart, addDays(gridEnd, 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, visibleIds, gridStart.getTime(), gridEnd.getTime()])

  // 按天分桶 (全天/跨天优先, 然后按开始时间)。
  const byDay = useMemo(() => {
    const map = new Map<string, EventOccurrence[]>()
    for (const occ of occurrences) {
      const s = new Date(occ.start)
      const e = new Date(occ.end)
      // 事件可能跨多天: 把它放进它覆盖的每一天。
      let d = new Date(s)
      d.setHours(0, 0, 0, 0)
      const last = new Date(e)
      last.setHours(0, 0, 0, 0)
      // 全天事件 end 常为次日 0 点, 回退一天避免多占一格。
      if (occ.event.allDay && last > d && e.getHours() === 0 && e.getMinutes() === 0) {
        last.setDate(last.getDate() - 1)
      }
      while (d <= last) {
        const key = format(d, 'yyyy-MM-dd')
        const arr = map.get(key) ?? []
        arr.push(occ)
        map.set(key, arr)
        d = addDays(d, 1)
      }
    }
    // 排序: 全天在前, 然后开始时间。
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        if (a.event.allDay !== b.event.allDay) return a.event.allDay ? -1 : 1
        return new Date(a.start).getTime() - new Date(b.start).getTime()
      })
    }
    return map
  }, [occurrences])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 星期表头 */}
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="py-2 text-center text-xs font-medium text-muted-foreground">
            {w}
          </div>
        ))}
      </div>

      {/* 日期网格 */}
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((day) => {
          const inMonth = isSameMonth(day, cursor)
          const today = isToday(day)
          const key = format(day, 'yyyy-MM-dd')
          const dayEvents = byDay.get(key) ?? []
          const MAX_CHIPS = 3
          const overflow = dayEvents.length - MAX_CHIPS

          return (
            <div
              key={key}
              onClick={() => onPickDay(day)}
              className={cn(
                'flex min-h-0 cursor-pointer flex-col gap-0.5 border-r border-b border-border p-1 transition-colors hover:bg-accent/40',
                !inMonth && 'bg-muted/30',
              )}
            >
              {/* 日期数字 */}
              <div className="flex justify-end px-0.5">
                <span
                  className={cn(
                    'grid size-6 place-items-center rounded-full text-xs',
                    today && 'bg-primary font-semibold text-primary-foreground',
                    !today && inMonth && 'text-foreground',
                    !today && !inMonth && 'text-muted-foreground/60',
                  )}
                >
                  {format(day, 'd')}
                </span>
              </div>

              {/* 事件 chip */}
              <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
                {dayEvents.slice(0, MAX_CHIPS).map((occ) => {
                  const cal = calendarOf(calendars, occ.event)
                  const color = cal?.color ?? FALLBACK_COLOR
                  const isStart = isSameDay(new Date(occ.start), day)
                  return (
                    <button
                      key={occ.key + key}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onPickEvent(occ.event.id)
                      }}
                      className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] leading-tight transition-opacity hover:opacity-80"
                      style={{
                        backgroundColor: hexToRgba(color, 0.16),
                        color,
                      }}
                    >
                      {!occ.event.allDay && isStart && (
                        <span className="tabular-nums opacity-80">
                          {format(new Date(occ.start), 'HH:mm')}
                        </span>
                      )}
                      <span className="truncate font-medium">{occ.event.title || '(无标题)'}</span>
                    </button>
                  )
                })}
                {overflow > 0 && (
                  <span className="px-1 text-[11px] font-medium text-muted-foreground">
                    +{overflow}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
