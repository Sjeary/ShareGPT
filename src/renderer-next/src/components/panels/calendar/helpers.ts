// 日历视图共用的纯函数: 时间布局、颜色、文案。
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { Calendar, CalendarEvent } from '@/store/useCalendarStore'
import type { EventOccurrence } from '@/lib/recurrence'

export type CalendarView = 'month' | 'week' | 'day'

// 时间网格: 每小时行高 (px) 与一天总高。
export const HOUR_HEIGHT = 48
export const DAY_HEIGHT = HOUR_HEIGHT * 24

// 新建日历的备选色板 (Apple 风格的明快色)。
export const CALENDAR_PALETTE = [
  '#3b82f6', // 蓝
  '#ef4444', // 红
  '#f59e0b', // 琥珀
  '#10b981', // 绿
  '#8b5cf6', // 紫
  '#ec4899', // 粉
  '#14b8a6', // 青
  '#f97316', // 橙
  '#6366f1', // 靛
  '#84cc16', // 黄绿
] as const

// 把 hex (#rrggbb) 转成 rgba 字符串, 用于半透明填充。
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return `rgba(59,130,246,${alpha})`
  return `rgba(${r},${g},${b},${alpha})`
}

// 当前时段标签 (随视图变化)。
export function periodLabel(date: Date, view: CalendarView): string {
  if (view === 'month') return format(date, 'yyyy年 M月', { locale: zhCN })
  if (view === 'day') return format(date, 'yyyy年 M月 d日 EEEE', { locale: zhCN })
  // 周视图: 显示所在周的年月。
  return format(date, 'yyyy年 M月', { locale: zhCN })
}

// 一个 occurrence 在某天内的像素布局 (top/height), 受当天 0~24 点裁剪。
export interface TimedLayout {
  topPx: number
  heightPx: number
}

export function layoutInDay(occ: EventOccurrence, day: Date): TimedLayout {
  const dayStart = new Date(day)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)

  const s = new Date(occ.start)
  const e = new Date(occ.end)
  const clampedStart = s < dayStart ? dayStart : s
  const clampedEnd = e > dayEnd ? dayEnd : e

  const startMin = (clampedStart.getTime() - dayStart.getTime()) / 60000
  const endMin = (clampedEnd.getTime() - dayStart.getTime()) / 60000
  const topPx = (startMin / 60) * HOUR_HEIGHT
  // 最小高度保证短事件可点。
  const heightPx = Math.max(18, ((endMin - startMin) / 60) * HOUR_HEIGHT)
  return { topPx, heightPx }
}

// 把同一天内重叠的定时事件分列, 避免相互遮挡 (简易区间着色算法)。
export interface PositionedOccurrence {
  occ: EventOccurrence
  layout: TimedLayout
  columnIndex: number
  columnCount: number
}

export function packDayColumns(
  occurrences: { occ: EventOccurrence; layout: TimedLayout }[],
): PositionedOccurrence[] {
  // 按开始时间排序。
  const sorted = [...occurrences].sort((a, b) => a.layout.topPx - b.layout.topPx)
  const result: PositionedOccurrence[] = []
  // 当前重叠簇。
  let cluster: { occ: EventOccurrence; layout: TimedLayout }[] = []
  let clusterEnd = -1

  const flush = () => {
    if (cluster.length === 0) return
    // 贪心列分配。
    const colEnds: number[] = []
    const assigned = cluster.map((item) => {
      let col = colEnds.findIndex((end) => end <= item.layout.topPx)
      if (col === -1) {
        col = colEnds.length
        colEnds.push(item.layout.topPx + item.layout.heightPx)
      } else {
        colEnds[col] = item.layout.topPx + item.layout.heightPx
      }
      return { ...item, columnIndex: col }
    })
    const columnCount = colEnds.length
    for (const a of assigned) {
      result.push({ occ: a.occ, layout: a.layout, columnIndex: a.columnIndex, columnCount })
    }
    cluster = []
  }

  for (const item of sorted) {
    const top = item.layout.topPx
    const bottom = item.layout.topPx + item.layout.heightPx
    if (cluster.length > 0 && top >= clusterEnd) {
      flush()
      clusterEnd = -1
    }
    cluster.push(item)
    clusterEnd = Math.max(clusterEnd, bottom)
  }
  flush()
  return result
}

// 取事件所属日历 (找不到给个兜底色)。
export function calendarOf(calendars: Calendar[], event: CalendarEvent): Calendar | undefined {
  return calendars.find((c) => c.id === event.calendarId)
}

export const FALLBACK_COLOR = '#3b82f6'

// 周一为首的星期表头。
export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

// 重复规则预设 (编辑器下拉)。
export type RecurrencePreset = 'none' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

export const RECURRENCE_OPTIONS: { value: RecurrencePreset; label: string }[] = [
  { value: 'none', label: '不重复' },
  { value: 'DAILY', label: '每天' },
  { value: 'WEEKLY', label: '每周' },
  { value: 'MONTHLY', label: '每月' },
  { value: 'YEARLY', label: '每年' },
]
