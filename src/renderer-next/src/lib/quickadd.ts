// 自然语言快速添加解析器 (对齐滴答清单快速添加)。
// 从一行输入中识别: 优先级 (!high/!中/...)、标签 (#tag)、自然日期 (今天/明天/下周一/周五…) 与时间 (下午5点/5pm/17:00…)
// 解析后从标题里剥离已识别的 token, 返回干净标题 + 结构化字段, 供 store 直接建任务。
// 设计取向: 简单、稳健、中英混合; 仅用 date-fns 做轻量日期推算, 不引第三方 NLP。
import { addDays, format, startOfDay } from 'date-fns'

export type ParsedPriority = 0 | 1 | 2 | 3

// 解析结果。dueDate/dueTime 为可选; title 一定有 (可能为空字符串)。
export interface ParsedQuickAdd {
  title: string
  priority: ParsedPriority
  tags: string[]
  dueDate?: string // 'YYYY-MM-DD'
  dueTime?: string // 'HH:mm'
}

// 人类可读的命中提示 (UI 在输入框下方显示一行小字)。
export interface QuickAddHint {
  label: string // 如 "今天" / "下午5点 17:00"
  kind: 'date' | 'time' | 'priority' | 'tag'
}

export interface QuickAddResult extends ParsedQuickAdd {
  hints: QuickAddHint[]
}

// —— 优先级关键词 —— (英文 !high 等 + 中文 高/中/低)
const PRIORITY_PATTERNS: { re: RegExp; value: ParsedPriority; label: string }[] = [
  { re: /(^|\s)!(?:high|h)\b/i, value: 3, label: '高优先级' },
  { re: /(^|\s)!(?:medium|med|m)\b/i, value: 2, label: '中优先级' },
  { re: /(^|\s)!(?:low|l)\b/i, value: 1, label: '低优先级' },
  { re: /(^|\s)!高/, value: 3, label: '高优先级' },
  { re: /(^|\s)!中/, value: 2, label: '中优先级' },
  { re: /(^|\s)!低/, value: 1, label: '低优先级' },
]

// —— 周几关键词 —— (周一..周日 / 星期一.. / 礼拜一..)
const WEEKDAY_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
}

const EN_WEEKDAY: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
}

const ymd = (d: Date) => format(d, 'yyyy-MM-dd')

// 在 from 之后(可含本周)找到下一个目标 weekday。nextWeek=true 强制下一周。
function dateForWeekday(target: number, from: Date, nextWeek: boolean): Date {
  const base = startOfDay(from)
  const cur = base.getDay()
  let delta = (target - cur + 7) % 7
  if (delta === 0) delta = 7 // 同一天则取下一周的该天, 避免歧义
  if (nextWeek && delta <= cur) delta += 7
  if (nextWeek) {
    // “下周X”: 跳到下一个自然周的该天
    const mondayDelta = (1 - cur + 7) % 7 || 7 // 到下周一
    const nextMonday = addDays(base, mondayDelta)
    const offsetInWeek = (target + 6) % 7 // 周一=0 ... 周日=6
    return addDays(nextMonday, offsetInWeek)
  }
  return addDays(base, delta)
}

// 把 hour(0-23)、minute 合成 'HH:mm'
function hhmm(hour: number, minute: number): string {
  const h = String(Math.max(0, Math.min(23, hour))).padStart(2, '0')
  const m = String(Math.max(0, Math.min(59, minute))).padStart(2, '0')
  return `${h}:${m}`
}

// 主解析入口。now 可注入便于测试; 默认取当前时间。
export function parseQuickAdd(raw: string, now: Date = new Date()): QuickAddResult {
  let text = ` ${raw} ` // 两侧留空格, 便于 \b 与 (^|\s) 边界统一
  const hints: QuickAddHint[] = []

  let priority: ParsedPriority = 0
  const tags: string[] = []
  let dueDate: string | undefined
  let dueTime: string | undefined

  // 1) 优先级 (取首个命中)
  for (const p of PRIORITY_PATTERNS) {
    const m = p.re.exec(text)
    if (m) {
      priority = p.value
      text = text.replace(p.re, ' ')
      hints.push({ label: p.label, kind: 'priority' })
      break
    }
  }

  // 2) 标签 #tag (中英数字与下划线/连字符)
  const tagRe = /(^|\s)#([\p{L}\p{N}_-]+)/gu
  text = text.replace(tagRe, (_all, _pre: string, tag: string) => {
    if (!tags.includes(tag)) {
      tags.push(tag)
      hints.push({ label: `#${tag}`, kind: 'tag' })
    }
    return ' '
  })

  // 3) 日期 (相对词 / 周几 / 下周几)
  const setDate = (d: Date, label: string) => {
    if (!dueDate) {
      dueDate = ymd(d)
      hints.push({ label, kind: 'date' })
    }
  }

  // 3a) 相对词
  const relative: { re: RegExp; offset: number; label: string }[] = [
    { re: /(^|\s)今天\b|(^|\s)today\b/i, offset: 0, label: '今天' },
    { re: /(^|\s)明天\b|(^|\s)tomorrow\b|(^|\s)tmr\b/i, offset: 1, label: '明天' },
    { re: /(^|\s)后天\b/, offset: 2, label: '后天' },
    { re: /(^|\s)大后天\b/, offset: 3, label: '大后天' },
  ]
  for (const r of relative) {
    if (r.re.test(text)) {
      setDate(addDays(startOfDay(now), r.offset), r.label)
      text = text.replace(r.re, ' ')
      break
    }
  }

  // 3b) 下周X / 这周X / 周X / 星期X / 礼拜X
  if (!dueDate) {
    const cnWeek = /(下|本|这)?(?:周|星期|礼拜)([一二三四五六日天])/
    const m = cnWeek.exec(text)
    if (m) {
      const target = WEEKDAY_MAP[m[2]]
      const nextWeek = m[1] === '下'
      setDate(dateForWeekday(target, now, nextWeek), `${m[1] ?? ''}周${m[2]}`)
      text = text.replace(cnWeek, ' ')
    }
  }

  // 3c) 英文 next monday / monday / fri
  if (!dueDate) {
    const enWeek =
      /(^|\s)(next\s+)?(sunday|sun|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat)\b/i
    const m = enWeek.exec(text)
    if (m) {
      const target = EN_WEEKDAY[m[3].toLowerCase()]
      const nextWeek = Boolean(m[2])
      setDate(dateForWeekday(target, now, nextWeek), m[0].trim())
      text = text.replace(enWeek, ' ')
    }
  }

  // 4) 时间
  const setTime = (h: number, min: number, label: string) => {
    if (!dueTime) {
      dueTime = hhmm(h, min)
      hints.push({ label: `${label} ${dueTime}`, kind: 'time' })
    }
  }

  // 4a) 中文 上午/下午/晚上/中午/早上 X点[半|Y分]
  if (!dueTime) {
    const cnTime = /(上午|早上|下午|晚上|中午|凌晨)?\s*([0-9]{1,2})\s*点\s*(半|[0-9]{1,2}\s*分?)?/
    const m = cnTime.exec(text)
    if (m) {
      let h = parseInt(m[2], 10)
      const period = m[1]
      // 下午/晚上 → +12 (12 点除外); 中午→12
      if ((period === '下午' || period === '晚上') && h < 12) h += 12
      else if (period === '中午') h = 12
      else if (period === '凌晨' && h === 12) h = 0
      let min = 0
      if (m[3]) min = m[3] === '半' ? 30 : parseInt(m[3], 10) || 0
      setTime(h, min, period ?? '')
      text = text.replace(cnTime, ' ')
    }
  }

  // 4b) 英文 5pm / 5:30pm / 17:00 / 9am
  if (!dueTime) {
    const enAmPm = /(^|\s)([0-9]{1,2})(?::([0-9]{2}))?\s*(am|pm)\b/i
    const m = enAmPm.exec(text)
    if (m) {
      let h = parseInt(m[2], 10)
      const min = m[3] ? parseInt(m[3], 10) : 0
      const isPm = m[4].toLowerCase() === 'pm'
      if (isPm && h < 12) h += 12
      if (!isPm && h === 12) h = 0
      setTime(h, min, m[4].toLowerCase())
      text = text.replace(enAmPm, ' ')
    }
  }

  // 4c) 24h HH:mm
  if (!dueTime) {
    const h24 = /(^|\s)([01]?[0-9]|2[0-3]):([0-5][0-9])\b/
    const m = h24.exec(text)
    if (m) {
      setTime(parseInt(m[2], 10), parseInt(m[3], 10), '')
      text = text.replace(h24, ' ')
    }
  }

  // 收尾: 折叠多余空白
  const title = text.replace(/\s+/g, ' ').trim()

  return { title, priority, tags, dueDate, dueTime, hints }
}
