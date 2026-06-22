// 自然语言快速添加解析器 (对齐滴答清单快速添加)。
// 从一行输入中识别: 优先级 (!high/!高/...)、标签 (#tag)、自然语言日期/时间 (明天下午5点 / 下周三 / 6月25号 / tomorrow 5pm…)。
// 解析后从标题里剥离已识别片段, 返回干净标题 + 结构化字段, 供 store 直接建任务。
//
// 日期/时间用 chrono-node (zh.hans 中文 + 英文) 解析:
//  - 中文无需空格分词即可命中 (旧版自写正则依赖 \b/(^|\s) 边界, 对连写中文如「明天写周报」失效)。
//  - chrono 返回命中片段的精确 index/text, 据此从标题里精确剥离, 不再误删/漏删 → 解决「分词不好」。
import { format } from 'date-fns'
import { casual, zh } from 'chrono-node'

export type ParsedPriority = 0 | 1 | 2 | 3

export interface ParsedQuickAdd {
  title: string
  priority: ParsedPriority
  tags: string[]
  dueDate?: string // 'YYYY-MM-DD'
  dueTime?: string // 'HH:mm'
}

export interface QuickAddHint {
  label: string
  kind: 'date' | 'time' | 'priority' | 'tag'
}

export interface QuickAddResult extends ParsedQuickAdd {
  hints: QuickAddHint[]
}

// —— 优先级关键词 —— 支持 !high/!h、!medium/!med/!m、!low/!l 及中文 !高/!中/!低 (半/全角叹号)。
// 不再要求前置空格, 以兼容中文连写 (如「写周报!high」)。
const PRIORITY_PATTERNS: { re: RegExp; value: ParsedPriority; label: string }[] = [
  { re: /[!！]\s*(?:high|h|高)/i, value: 3, label: '高优先级' },
  { re: /[!！]\s*(?:medium|med|m|中)/i, value: 2, label: '中优先级' },
  { re: /[!！]\s*(?:low|l|低)/i, value: 1, label: '低优先级' },
]

// #标签: 中英数字 + 下划线/连字符; 不要求前置空格 (兼容中文连写)。
const TAG_RE = /[#＃]([\p{L}\p{N}_-]+)/gu

function hhmm(hour: number, minute: number): string {
  const h = String(Math.max(0, Math.min(23, hour))).padStart(2, '0')
  const m = String(Math.max(0, Math.min(59, minute))).padStart(2, '0')
  return `${h}:${m}`
}

// 主解析入口。now 可注入便于测试; 默认当前时间。
export function parseQuickAdd(raw: string, now: Date = new Date()): QuickAddResult {
  let text = raw
  const hints: QuickAddHint[] = []

  let priority: ParsedPriority = 0
  const tags: string[] = []
  let dueDate: string | undefined
  let dueTime: string | undefined

  // 1) 优先级 (取首个命中后剥离)
  for (const p of PRIORITY_PATTERNS) {
    if (p.re.test(text)) {
      priority = p.value
      text = text.replace(p.re, ' ')
      hints.push({ label: p.label, kind: 'priority' })
      break
    }
  }

  // 2) 标签 #tag (可多个)
  text = text.replace(TAG_RE, (_all, tag: string) => {
    if (!tags.includes(tag)) {
      tags.push(tag)
      hints.push({ label: `#${tag}`, kind: 'tag' })
    }
    return ' '
  })

  // 3) 日期/时间: chrono 中文优先, 英文兜底; forwardDate 让「周五/5pm」指向将来。
  const opts = { forwardDate: true }
  const result = zh.hans.parse(text, now, opts)[0] ?? casual.parse(text, now, opts)[0] ?? null
  if (result) {
    const d = result.start.date()
    dueDate = format(d, 'yyyy-MM-dd')
    hints.push({ label: result.text.trim(), kind: 'date' })
    // 仅当明确给了「小时」才认为带具体时间 (否则视为全天)。
    if (result.start.isCertain('hour')) {
      dueTime = hhmm(d.getHours(), d.getMinutes())
      hints.push({ label: dueTime, kind: 'time' })
    }
    // 按 chrono 命中的精确区间剥离, 标题不残留日期词。
    text = text.slice(0, result.index) + text.slice(result.index + result.text.length)
  }

  const title = text.replace(/\s+/g, ' ').trim()
  return { title, priority, tags, dueDate, dueTime, hints }
}
