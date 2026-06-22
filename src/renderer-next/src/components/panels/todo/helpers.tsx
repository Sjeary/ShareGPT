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

// —— 便签调色板 —— (参考 Google Keep, 柔和雅致, 浅/深色都耐看)
export interface MemoColor {
  name: string
  bg: string // 浅色背景
  darkBg: string // 深色背景
}

export const MEMO_COLORS: MemoColor[] = [
  { name: '默认', bg: '#ffffff', darkBg: '#27272a' },
  { name: '黄', bg: '#fef7cd', darkBg: '#403a1d' },
  { name: '橙', bg: '#ffe4c7', darkBg: '#42301c' },
  { name: '红', bg: '#ffdcdc', darkBg: '#412528' },
  { name: '绿', bg: '#d8f5d3', darkBg: '#22361f' },
  { name: '青', bg: '#cdf2ec', darkBg: '#163530' },
  { name: '蓝', bg: '#d7ecff', darkBg: '#1a3043' },
  { name: '紫', bg: '#e7defb', darkBg: '#2b2447' },
  { name: '粉', bg: '#ffdff0', darkBg: '#3f2338' },
]

// 取便签底色 (按当前是否深色返回对应值)。兼容旧色值: 命中调色板按主题给深/浅变体;
// 未命中(老数据/自定义)时, 深色模式回退到中性深色卡, 避免浅底配浅字不可读。
export function memoBg(color: string, dark: boolean): string {
  const found = MEMO_COLORS.find((c) => c.bg === color)
  if (found) return dark ? found.darkBg : found.bg
  if (dark && isLightColor(color)) return '#2e2e33' // 老的浅色值在深色模式回退中性深卡
  return color
}

// 判断底色是否偏亮 (据感知亮度), 用于决定卡片文字取深色还是浅色, 保证任意底色都可读。
export function isLightColor(hex: string): boolean {
  const m = hex.replace('#', '')
  if (m.length < 6) return true
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  if ([r, g, b].some((v) => Number.isNaN(v))) return true
  return 0.299 * r + 0.587 * g + 0.114 * b > 140
}

// 便签更新时间的简短文案 (今天显示时刻, 否则显示日期)。
export function memoTimeLabel(iso: string): string {
  try {
    const d = parseISO(iso)
    if (isToday(d)) return format(d, 'HH:mm')
    const sameYear = d.getFullYear() === new Date().getFullYear()
    return format(d, sameYear ? 'M月d日' : 'yyyy/M/d', { locale: zhCN })
  } catch {
    return ''
  }
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
