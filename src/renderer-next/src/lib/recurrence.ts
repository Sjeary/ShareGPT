// 重复事件展开工具。
// 把一个带 recurrence 规则的事件, 在给定可见日期区间内展开成若干「具体发生」(occurrence)。
// 设计要点:
//  - 每个展开出来的 occurrence 复用原事件 id, 但带一个 occurrenceStart 标记本次发生的起点;
//    视图层用 `${id}@${occurrenceStart}` 当 React key, 编辑时仍按原 id 找到母事件。
//  - 仅在区间内枚举, 并设硬上限防止 until 缺失时无限循环。
import { addDays, addMonths, addWeeks, addYears, isAfter, isBefore } from 'date-fns'
import type { CalendarEvent, RecurrenceFreq } from '@/store/useCalendarStore'

// 一次具体发生: 在原事件基础上替换 start/end 为本次发生的时间。
export interface EventOccurrence {
  event: CalendarEvent
  // 本次发生的起止 (ISO)。非重复事件即等于 event.start/end。
  start: string
  end: string
  // 视图层唯一 key (母事件 id + 本次起点)。
  key: string
}

// 单次步进。
function step(date: Date, freq: RecurrenceFreq, interval: number): Date {
  switch (freq) {
    case 'DAILY':
      return addDays(date, interval)
    case 'WEEKLY':
      return addWeeks(date, interval)
    case 'MONTHLY':
      return addMonths(date, interval)
    case 'YEARLY':
      return addYears(date, interval)
  }
}

// 防御性硬上限: 单个事件在一个区间内最多展开多少次。
const MAX_OCCURRENCES = 750

// 把一个事件展开到 [rangeStart, rangeEnd] 区间 (含端点重叠即算命中)。
export function expandEvent(
  event: CalendarEvent,
  rangeStart: Date,
  rangeEnd: Date,
): EventOccurrence[] {
  const baseStart = new Date(event.start)
  const baseEnd = new Date(event.end)
  // 事件本身的持续时长 (ms), 用于推算每次发生的结束时间。
  const durationMs = Math.max(0, baseEnd.getTime() - baseStart.getTime())

  // 非重复: 命中区间则返回单条。
  if (!event.recurrence) {
    if (isAfter(baseStart, rangeEnd) || isBefore(baseEnd, rangeStart)) return []
    return [{ event, start: event.start, end: event.end, key: event.id }]
  }

  const { freq, interval, until } = event.recurrence
  const safeInterval = Math.max(1, Math.floor(interval) || 1)
  const untilDate = until ? new Date(until) : null

  const out: EventOccurrence[] = []
  let cursor = baseStart
  let guard = 0

  while (guard < MAX_OCCURRENCES) {
    guard += 1
    // 超过 until 或越过区间右界则停止。
    if (untilDate && isAfter(cursor, untilDate)) break
    if (isAfter(cursor, rangeEnd)) break

    const occEnd = new Date(cursor.getTime() + durationMs)
    // 与区间有重叠才纳入 (左界用 occEnd 比较, 避免漏掉跨界的长事件)。
    if (!isBefore(occEnd, rangeStart)) {
      const startIso = cursor.toISOString()
      out.push({
        event,
        start: startIso,
        end: occEnd.toISOString(),
        key: `${event.id}@${startIso}`,
      })
    }
    cursor = step(cursor, freq, safeInterval)
  }

  return out
}

// 展开一组事件到区间, 已扁平化。
export function expandEvents(
  events: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): EventOccurrence[] {
  const out: EventOccurrence[] = []
  for (const ev of events) out.push(...expandEvent(ev, rangeStart, rangeEnd))
  return out
}
