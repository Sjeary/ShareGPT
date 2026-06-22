// 极简但健壮的 iCalendar (.ics) 解析器。
// 目标: 从外部日历文件里把 VEVENT 块解析成统一的 ImportedEvent 数组, 供导入用。
// 设计原则:
//  - 防御性: 任何一行/一个事件解析失败都不抛异常, 直接跳过坏数据。
//  - 只关心 VEVENT, 忽略 VTODO / VTIMEZONE / VALARM 等其它块。
//  - 处理折行 (continuation line: 以空格或 Tab 开头的行是上一行的续行)。
//  - DTSTART/DTEND 同时支持 DATE (全天, 8 位数字或 VALUE=DATE) 与 DATE-TIME
//    (带 Z 视为 UTC; 不带 Z 的裸时间视为本地时区)。
//  - 反转义 SUMMARY/DESCRIPTION/LOCATION 里的 \n \\ \; \, \: 等。

// 导入后的统一事件形状 (与 store 的 CalendarEvent 解耦, 由调用方再映射)。
export interface ImportedEvent {
  uid?: string
  title: string
  start: string // ISO
  end: string // ISO
  allDay: boolean
  location?: string
  description?: string
}

// —— 折行还原 ——
// RFC5545 规定: 续行以单个空格或水平 Tab 开头, 需把该前导空白去掉后拼回上一行。
function unfoldLines(text: string): string[] {
  // 统一换行符, 再按行切。
  const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const out: string[] = []
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      // 续行: 去掉前导的 1 个空白字符, 拼到上一行末尾。
      out[out.length - 1] += line.slice(1)
    } else {
      out.push(line)
    }
  }
  return out
}

// —— 文本值反转义 ——
// 注意: 转义序列里反斜杠在前, 需要一次扫描而不是多次 replace, 避免 "\\n" 被误解。
function unescapeText(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '\\' && i + 1 < value.length) {
      const next = value[i + 1]
      if (next === 'n' || next === 'N') {
        out += '\n'
      } else if (next === '\\' || next === ';' || next === ',' || next === ':') {
        out += next
      } else {
        // 未知转义: 原样保留下一个字符。
        out += next
      }
      i++ // 跳过被转义的字符
    } else {
      out += ch
    }
  }
  return out
}

// 一行属性拆成 { name, params, value }。
//  形如: DTSTART;VALUE=DATE;TZID=Asia/Shanghai:20260101  或  SUMMARY:开会
interface ParsedLine {
  name: string
  params: Record<string, string>
  value: string
}

function parseLine(line: string): ParsedLine | null {
  const colonIdx = line.indexOf(':')
  if (colonIdx === -1) return null
  const left = line.slice(0, colonIdx)
  const value = line.slice(colonIdx + 1)
  // 左侧再按 ; 拆出属性名与参数。
  const parts = left.split(';')
  const name = (parts[0] ?? '').trim().toUpperCase()
  if (!name) return null
  const params: Record<string, string> = {}
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=')
    if (eq === -1) continue
    const pName = parts[i].slice(0, eq).trim().toUpperCase()
    const pVal = parts[i].slice(eq + 1).trim()
    params[pName] = pVal
  }
  return { name, params, value }
}

// 解析出来的日期结果: ISO 字符串 + 是否全天 (DATE 形式)。
interface ParsedDate {
  iso: string
  allDay: boolean
}

// 把 ICS 的日期/时间值解析成 ISO。
//  - 8 位纯数字 (YYYYMMDD) 或 VALUE=DATE -> 全天, 取本地当天 0 点。
//  - YYYYMMDDTHHMMSSZ -> UTC 时间。
//  - YYYYMMDDTHHMMSS  -> 裸时间, 按本地时区解释。
function parseDate(value: string, params: Record<string, string>): ParsedDate | null {
  const v = value.trim()
  // 全天判定: 显式 VALUE=DATE, 或形如 8 位数字。
  const isDateOnly = params.VALUE === 'DATE' || /^\d{8}$/.test(v)
  if (isDateOnly) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(v)
    if (!m) return null
    const y = Number(m[1])
    const mo = Number(m[2])
    const d = Number(m[3])
    const dt = new Date(y, mo - 1, d, 0, 0, 0, 0)
    if (Number.isNaN(dt.getTime())) return null
    return { iso: dt.toISOString(), allDay: true }
  }

  // 日期时间: YYYYMMDDTHHMMSS(Z)?
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const hh = Number(m[4])
  const mm = Number(m[5])
  const ss = Number(m[6] ?? '0')
  const isUtc = m[7] === 'Z'
  const dt = isUtc
    ? new Date(Date.UTC(y, mo - 1, d, hh, mm, ss))
    : new Date(y, mo - 1, d, hh, mm, ss)
  if (Number.isNaN(dt.getTime())) return null
  return { iso: dt.toISOString(), allDay: false }
}

// 单个 VEVENT 块 (行集合) -> ImportedEvent, 解析失败返回 null。
function parseVevent(lines: ParsedLine[]): ImportedEvent | null {
  let uid: string | undefined
  let title = ''
  let location: string | undefined
  let description: string | undefined
  let startParsed: ParsedDate | null = null
  let endParsed: ParsedDate | null = null

  for (const ln of lines) {
    switch (ln.name) {
      case 'UID':
        uid = ln.value.trim() || undefined
        break
      case 'SUMMARY':
        title = unescapeText(ln.value)
        break
      case 'LOCATION':
        location = unescapeText(ln.value) || undefined
        break
      case 'DESCRIPTION':
        description = unescapeText(ln.value) || undefined
        break
      case 'DTSTART':
        startParsed = parseDate(ln.value, ln.params)
        break
      case 'DTEND':
        endParsed = parseDate(ln.value, ln.params)
        break
      default:
        break
    }
  }

  // 没有有效起点的事件直接丢弃。
  if (!startParsed) return null

  const allDay = startParsed.allDay
  const startMs = new Date(startParsed.iso).getTime()

  let endIso: string
  if (endParsed) {
    endIso = endParsed.iso
  } else {
    // 缺 DTEND: 定时事件 +1 小时, 全天事件 +1 天。
    const delta = allDay ? 24 * 3600_000 : 3600_000
    endIso = new Date(startMs + delta).toISOString()
  }

  // 结束早于开始: 兜底顺延。
  if (new Date(endIso).getTime() < startMs) {
    endIso = new Date(startMs + (allDay ? 24 * 3600_000 : 3600_000)).toISOString()
  }

  return {
    uid,
    title: title || '(无标题)',
    start: startParsed.iso,
    end: endIso,
    allDay,
    location,
    description,
  }
}

// 入口: 解析整份 .ics 文本, 返回所有可识别的事件 (坏事件被跳过)。
export function parseIcs(text: string): ImportedEvent[] {
  if (typeof text !== 'string' || text.length === 0) return []
  let lines: string[]
  try {
    lines = unfoldLines(text)
  } catch {
    return []
  }

  const events: ImportedEvent[] = []
  let inEvent = false
  let current: ParsedLine[] = []

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (trimmed.toUpperCase() === 'BEGIN:VEVENT') {
      inEvent = true
      current = []
      continue
    }
    if (trimmed.toUpperCase() === 'END:VEVENT') {
      inEvent = false
      try {
        const ev = parseVevent(current)
        if (ev) events.push(ev)
      } catch {
        // 单个事件解析异常: 跳过, 不影响其它事件。
      }
      current = []
      continue
    }
    if (!inEvent) continue
    // 处理 VEVENT 内的属性行 (容错: parseLine 返回 null 即跳过该行)。
    const parsed = parseLine(rawLine)
    if (parsed) current.push(parsed)
  }

  return events
}
