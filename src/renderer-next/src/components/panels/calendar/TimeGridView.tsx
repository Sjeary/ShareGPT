import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, format, isToday, startOfDay } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { useCalendarStore } from '@/store/useCalendarStore'
import { expandEvents, type EventOccurrence } from '@/lib/recurrence'
import {
  HOUR_HEIGHT,
  DAY_HEIGHT,
  hexToRgba,
  calendarOf,
  FALLBACK_COLOR,
  layoutInDay,
  packDayColumns,
} from './helpers'

const HOURS = Array.from({ length: 24 }, (_, i) => i)

// 周/日视图共用的时间网格。
//  - 顶部固定: 各天表头 + 全天事件行。
//  - 主体: 0~24 小时网格, 定时事件按时间定位 (半透明填充 + 左侧色条), 重叠分列。
//  - 今天列叠加红色当前时间线 (含圆点), 每分钟刷新。
export function TimeGridView({
  days,
  onPickSlot,
  onPickEvent,
}: {
  days: Date[]
  // 点击空白时段 -> 新建 (传该时段起点)。
  onPickSlot: (slotStart: Date) => void
  onPickEvent: (eventId: string) => void
}) {
  const calendars = useCalendarStore((s) => s.calendars)
  const events = useCalendarStore((s) => s.events)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 当前时间 (每分钟刷新, 驱动红线)。
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  // 首次挂载滚动到 ~8 点, 贴近 Apple 默认视口。
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7.5 * HOUR_HEIGHT
  }, [])

  const visibleIds = useMemo(
    () => new Set(calendars.filter((c) => c.visible).map((c) => c.id)),
    [calendars],
  )

  const rangeStart = startOfDay(days[0])
  const rangeEnd = addDays(startOfDay(days[days.length - 1]), 1)

  const occurrences = useMemo(() => {
    const visible = events.filter((e) => visibleIds.has(e.calendarId))
    return expandEvents(visible, rangeStart, rangeEnd)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, visibleIds, rangeStart.getTime(), rangeEnd.getTime()])

  // 分流: 全天 / 定时。
  const { allDayByDay, timedByDay } = useMemo(() => {
    const allDayByDay = new Map<string, EventOccurrence[]>()
    const timedByDay = new Map<string, EventOccurrence[]>()
    for (const occ of occurrences) {
      // 该 occurrence 覆盖到的天 (与本视图 days 取交集)。
      for (const day of days) {
        const dayStart = startOfDay(day)
        const dayEnd = addDays(dayStart, 1)
        const s = new Date(occ.start)
        const e = new Date(occ.end)
        if (e <= dayStart || s >= dayEnd) continue
        const key = format(day, 'yyyy-MM-dd')
        const target = occ.event.allDay ? allDayByDay : timedByDay
        const arr = target.get(key) ?? []
        arr.push(occ)
        target.set(key, arr)
      }
    }
    return { allDayByDay, timedByDay }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occurrences, days.map((d) => d.getTime()).join(',')])

  const colWidth = `${100 / days.length}%`
  // 全天行高度: 取最多全天事件的天数, 至少一行。
  const maxAllDay = Math.max(
    0,
    ...days.map((d) => allDayByDay.get(format(d, 'yyyy-MM-dd'))?.length ?? 0),
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 顶部: 表头 + 全天行 (随主体不滚动) */}
      <div className="flex shrink-0 border-b border-border">
        {/* 左侧时间列占位 */}
        <div className="w-16 shrink-0 border-r border-border" />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* 天表头 */}
          <div className="flex">
            {days.map((day) => {
              const today = isToday(day)
              return (
                <div
                  key={format(day, 'yyyy-MM-dd')}
                  className="flex flex-col items-center gap-0.5 border-r border-border py-2.5 last:border-r-0"
                  style={{ width: colWidth }}
                >
                  <span className="text-sm text-muted-foreground">
                    {format(day, 'EEE', { locale: zhCN })}
                  </span>
                  <span
                    className={cn(
                      'grid size-8 place-items-center rounded-full text-base',
                      today
                        ? 'bg-primary font-semibold text-primary-foreground'
                        : 'text-foreground',
                    )}
                  >
                    {format(day, 'd')}
                  </span>
                </div>
              )
            })}
          </div>
          {/* 全天事件行 */}
          {maxAllDay > 0 && (
            <div className="flex border-t border-border">
              {days.map((day) => {
                const key = format(day, 'yyyy-MM-dd')
                const list = allDayByDay.get(key) ?? []
                return (
                  <div
                    key={key}
                    className="flex flex-col gap-0.5 border-r border-border p-1 last:border-r-0"
                    style={{ width: colWidth }}
                  >
                    {list.map((occ) => {
                      const color = calendarOf(calendars, occ.event)?.color ?? FALLBACK_COLOR
                      return (
                        <button
                          key={occ.key + key}
                          type="button"
                          onClick={() => onPickEvent(occ.event.id)}
                          className="truncate rounded px-1.5 py-1 text-left text-sm font-medium hover:opacity-80"
                          style={{ backgroundColor: hexToRgba(color, 0.18), color }}
                        >
                          {occ.event.title || '(无标题)'}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 主体: 滚动时间网格 */}
      <div ref={scrollRef} className="flex min-h-0 flex-1 overflow-y-auto">
        {/* 时间刻度列 */}
        <div className="w-16 shrink-0 border-r border-border" style={{ height: DAY_HEIGHT }}>
          {HOURS.map((h) => (
            <div
              key={h}
              className="relative border-b border-transparent text-right"
              style={{ height: HOUR_HEIGHT }}
            >
              {h > 0 && (
                <span className="absolute -top-2.5 right-2 text-sm tabular-nums text-muted-foreground">
                  {String(h).padStart(2, '0')}:00
                </span>
              )}
            </div>
          ))}
        </div>

        {/* 各天列 */}
        <div className="flex min-w-0 flex-1">
          {days.map((day) => (
            <DayColumn
              key={format(day, 'yyyy-MM-dd')}
              day={day}
              width={colWidth}
              now={now}
              occurrences={timedByDay.get(format(day, 'yyyy-MM-dd')) ?? []}
              onPickSlot={onPickSlot}
              onPickEvent={onPickEvent}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// 单天列: 小时格背景 + 定时事件块 + (今天) 当前时间红线。
function DayColumn({
  day,
  width,
  now,
  occurrences,
  onPickSlot,
  onPickEvent,
}: {
  day: Date
  width: string
  now: Date
  occurrences: EventOccurrence[]
  onPickSlot: (slotStart: Date) => void
  onPickEvent: (eventId: string) => void
}) {
  const calendars = useCalendarStore((s) => s.calendars)

  // 计算布局 + 重叠分列。
  const positioned = useMemo(() => {
    const withLayout = occurrences.map((occ) => ({ occ, layout: layoutInDay(occ, day) }))
    return packDayColumns(withLayout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occurrences, day.getTime()])

  // 点击空白: 按 y 像素换算成整点/半点。
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 仅响应背景点击 (事件块自己 stopPropagation)。
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const minutes = Math.floor((y / HOUR_HEIGHT) * 60)
    const snapped = Math.floor(minutes / 30) * 30
    const slot = startOfDay(day)
    slot.setMinutes(snapped)
    onPickSlot(slot)
  }

  const showNowLine = isToday(day)
  const nowTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_HEIGHT

  return (
    <div
      onClick={handleClick}
      className="relative border-r border-border last:border-r-0"
      style={{ width, height: DAY_HEIGHT }}
    >
      {/* 小时分隔线 */}
      {HOURS.map((h) => (
        <div
          key={h}
          className="absolute inset-x-0 border-b border-border/60"
          style={{ top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}
        />
      ))}

      {/* 事件块 */}
      {positioned.map(({ occ, layout, columnIndex, columnCount }) => {
        const color = calendarOf(calendars, occ.event)?.color ?? FALLBACK_COLOR
        const gapPct = 1
        const widthPct = 100 / columnCount
        const leftPct = widthPct * columnIndex
        return (
          <button
            key={occ.key}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onPickEvent(occ.event.id)
            }}
            className="absolute overflow-hidden rounded-md px-2 py-1 text-left text-sm leading-tight transition-shadow hover:shadow-md"
            style={{
              top: layout.topPx,
              height: layout.heightPx,
              left: `calc(${leftPct}% + 2px)`,
              width: `calc(${widthPct}% - ${gapPct + 2}px)`,
              backgroundColor: hexToRgba(color, 0.16),
              borderLeft: `3px solid ${color}`,
              color,
            }}
          >
            <span className="block truncate font-semibold">{occ.event.title || '(无标题)'}</span>
            {layout.heightPx > 38 && (
              <span className="block truncate tabular-nums opacity-80">
                {format(new Date(occ.start), 'HH:mm')}
              </span>
            )}
          </button>
        )
      })}

      {/* 当前时间红线 */}
      {showNowLine && (
        <div
          className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
          style={{ top: nowTop }}
        >
          <span className="-ml-1 size-2.5 rounded-full bg-red-500" />
          <span className="h-px flex-1 bg-red-500" />
        </div>
      )}
    </div>
  )
}
