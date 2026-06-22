import { differenceInCalendarDays, format, isToday, isTomorrow, parseISO } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { Priority } from '@/store/useTasksStore'

// 待办模块共享小工具: 优先级配色 / 到期文案 / 便签调色板。

// —— 优先级 —— (高=红 中=琥珀 低=蓝 无=灰)
export const PRIORITY_META: Record<
  Priority,
  { label: string; flag: string; dot: string; text: string }
> = {
  3: { label: '高', flag: 'text-red-500', dot: 'bg-red-500', text: 'text-red-500' },
  2: { label: '中', flag: 'text-amber-500', dot: 'bg-amber-500', text: 'text-amber-500' },
  1: { label: '低', flag: 'text-blue-500', dot: 'bg-blue-500', text: 'text-blue-500' },
  0: {
    label: '无',
    flag: 'text-muted-foreground/40',
    dot: 'bg-muted-foreground/40',
    text: 'text-muted-foreground',
  },
}

export const PRIORITY_OPTIONS: Priority[] = [3, 2, 1, 0]

// —— 到期文案 —— 返回 { label, overdue }。dueTime 存在则附带时间。
export function formatDue(
  dueDate?: string,
  dueTime?: string,
): { label: string; overdue: boolean } | null {
  if (!dueDate) return null
  const d = parseISO(dueDate)
  const diff = differenceInCalendarDays(d, new Date())
  let day: string
  if (isToday(d)) day = '今天'
  else if (isTomorrow(d)) day = '明天'
  else if (diff === -1) day = '昨天'
  else if (diff < 0 && diff >= -7) day = `${-diff}天前`
  else if (diff > 0 && diff <= 7) day = format(d, 'EEEE', { locale: zhCN })
  else day = format(d, 'M月d日', { locale: zhCN })
  const label = dueTime ? `${day} ${dueTime}` : day
  // 逾期: 严格早于今天 (今天到期不算逾期)。
  const overdue = diff < 0
  return { label, overdue }
}

// —— 便签调色板 —— (柔和的便利贴色, 浅/深色都可读)
export interface MemoColor {
  name: string
  bg: string // 浅色背景
  darkBg: string // 深色背景
}

export const MEMO_COLORS: MemoColor[] = [
  { name: '黄', bg: '#fff3bf', darkBg: '#4a3f1a' },
  { name: '绿', bg: '#d3f9d8', darkBg: '#1e3a26' },
  { name: '蓝', bg: '#d0ebff', darkBg: '#1b3346' },
  { name: '粉', bg: '#ffdeeb', darkBg: '#45203a' },
  { name: '紫', bg: '#e5dbff', darkBg: '#2e2348' },
  { name: '橙', bg: '#ffe8cc', darkBg: '#4a3018' },
  { name: '灰', bg: '#e9ecef', darkBg: '#2a3340' },
]

// 取便签底色 (按当前是否深色返回对应值)。
export function memoBg(color: string, dark: boolean): string {
  const found = MEMO_COLORS.find((c) => c.bg === color)
  if (!found) return color
  return dark ? found.darkBg : found.bg
}

// 清单颜色候选 (新建/编辑清单用)。
export const LIST_COLORS = [
  '#ef4444',
  '#f59e0b',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#8e8e93',
]
