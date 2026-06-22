import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { TeamEvent } from '@/store/useTeamCalendarStore'

// 组队日历视图所需的纯日期工具 (date-fns v4 + zhCN)。
// 周以周一为首 (飞书/国内习惯): weekStartsOn: 1。

const WEEK_OPTS = { weekStartsOn: 1 as const, locale: zhCN }

// 月视图: 返回覆盖整月的 6*7 网格 (含上/下月补齐)。
export function monthGridDays(anchorIso: string): Date[] {
  const anchor = parseISO(anchorIso)
  const gridStart = startOfWeek(startOfMonth(anchor), WEEK_OPTS)
  const gridEnd = endOfWeek(endOfMonth(anchor), WEEK_OPTS)
  return eachDayOfInterval({ start: gridStart, end: gridEnd })
}

// 周视图: 返回当前周的 7 天。
export function weekDays(anchorIso: string): Date[] {
  const anchor = parseISO(anchorIso)
  const start = startOfWeek(anchor, WEEK_OPTS)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

// 周一到周日的中文表头。
export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

export function fmtMonthTitle(anchorIso: string): string {
  return format(parseISO(anchorIso), 'yyyy 年 M 月', { locale: zhCN })
}

export function fmtWeekTitle(anchorIso: string): string {
  const days = weekDays(anchorIso)
  const first = days[0]
  const last = days[6]
  return `${format(first, 'M月d日', { locale: zhCN })} - ${format(last, 'M月d日', { locale: zhCN })}`
}

export function fmtDayNumber(day: Date): string {
  return format(day, 'd')
}

export function fmtTime(iso: string): string {
  try {
    return format(parseISO(iso), 'HH:mm')
  } catch {
    return ''
  }
}

export function fmtDateTimeLong(iso: string): string {
  try {
    return format(parseISO(iso), 'M月d日 EEEE HH:mm', { locale: zhCN })
  } catch {
    return iso
  }
}

// 某天是否落在事件区间内 (按天粒度, 支持跨天事件)。
export function eventOccursOnDay(event: TeamEvent, day: Date): boolean {
  try {
    const s = startOfDay(parseISO(event.start))
    const e = startOfDay(parseISO(event.end || event.start))
    const d = startOfDay(day)
    return (d >= s && d <= e) || isSameDay(d, s)
  } catch {
    return false
  }
}

export { isSameDay, format, parseISO }

// <input type="datetime-local"> 需要 'yyyy-MM-ddTHH:mm' 本地时间字符串。
export function toLocalInputValue(iso: string): string {
  try {
    return format(parseISO(iso), "yyyy-MM-dd'T'HH:mm")
  } catch {
    return ''
  }
}

// 从 datetime-local 的本地字符串构造 ISO。
export function fromLocalInputValue(local: string): string {
  if (!local) return ''
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

// all-day 用 date input ('yyyy-MM-dd')。
export function toDateInputValue(iso: string): string {
  try {
    return format(parseISO(iso), 'yyyy-MM-dd')
  } catch {
    return ''
  }
}
