import { create } from 'zustand'
import { api } from '@/lib/api'
import type { CalendarStoreFile } from '@/types/api'

// 个人日历 store。
// 数据持久化: api.loadCalendar() / api.saveCalendar() (本地文件壳, 结构由本 store 维护)。
//  - 初始化时 load 一次; 首次为空则播种默认日历 + 示例事件。
//  - 任何 calendars/events 变更后 debounce(~300ms) 落盘。
// 视图层用 selectors (按区间展开重复事件) 拿数据, 不直接读裸 events。

// —— 数据模型 ——
export type RecurrenceFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

export interface Recurrence {
  freq: RecurrenceFreq
  interval: number
  until?: string // ISO 日期 (含), 缺省表示无限重复
}

export interface Calendar {
  id: string
  name: string
  color: string // hex, 如 #3b82f6
  visible: boolean
  isDefault?: boolean
}

export interface CalendarEvent {
  id: string
  calendarId: string
  title: string
  start: string // ISO
  end: string // ISO
  allDay: boolean
  location?: string
  notes?: string
  url?: string
  recurrence?: Recurrence | null
  createdAt: string
  updatedAt: string
}

// 新建事件入参 (id / 时间戳由 store 补齐)。
export type NewEventInput = Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>

interface CalendarState {
  calendars: Calendar[]
  events: CalendarEvent[]
  loaded: boolean

  // 生命周期
  init: () => Promise<void>

  // 日历 CRUD
  addCalendar: (input: { name: string; color: string }) => Calendar
  updateCalendar: (id: string, patch: Partial<Omit<Calendar, 'id'>>) => void
  removeCalendar: (id: string) => void
  toggleCalendarVisible: (id: string) => void

  // 事件 CRUD
  addEvent: (input: NewEventInput) => CalendarEvent
  updateEvent: (id: string, patch: Partial<Omit<CalendarEvent, 'id' | 'createdAt'>>) => void
  removeEvent: (id: string) => void

  // 批量导入: 把外部解析出的事件落进 (按需创建) 一个专用「导入」日历。返回导入数量。
  importEvents: (
    items: {
      title: string
      start: string
      end: string
      allDay: boolean
      location?: string
      notes?: string
    }[],
  ) => number

  // 用(云端合并后的)整组数据替换本地 (云同步用); 会触发本地落盘。
  replaceAll: (data: { calendars: Calendar[]; events: CalendarEvent[] }) => void
}

// 专用「导入」日历的固定名称与颜色 (青色, 与其它默认日历区分)。
const IMPORT_CALENDAR_NAME = '导入'
const IMPORT_CALENDAR_COLOR = '#14b8a6'

// —— 默认播种 —— (首次运行, 本地无数据时)
function nowIso(): string {
  return new Date().toISOString()
}

// 把 Date 设为今天某点钟, 返回 ISO (用于示例事件落在本周)。
function atHour(base: Date, dayOffset: number, hour: number, minute = 0): string {
  const d = new Date(base)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

function seedDefaults(): { calendars: Calendar[]; events: CalendarEvent[] } {
  const personalId = crypto.randomUUID()
  const workId = crypto.randomUUID()
  const birthdayId = crypto.randomUUID()
  const created = nowIso()

  const calendars: Calendar[] = [
    { id: personalId, name: '个人', color: '#3b82f6', visible: true, isDefault: true },
    { id: workId, name: '工作', color: '#ef4444', visible: true },
    { id: birthdayId, name: '生日', color: '#f59e0b', visible: true },
  ]

  const today = new Date()
  const events: CalendarEvent[] = [
    {
      id: crypto.randomUUID(),
      calendarId: workId,
      title: '周会',
      start: atHour(today, 0, 10, 0),
      end: atHour(today, 0, 11, 0),
      allDay: false,
      location: '会议室 A',
      notes: '同步本周进度',
      recurrence: { freq: 'WEEKLY', interval: 1 },
      createdAt: created,
      updatedAt: created,
    },
    {
      id: crypto.randomUUID(),
      calendarId: personalId,
      title: '健身',
      start: atHour(today, 1, 19, 0),
      end: atHour(today, 1, 20, 30),
      allDay: false,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: crypto.randomUUID(),
      calendarId: personalId,
      title: '看牙医',
      start: atHour(today, 2, 14, 30),
      end: atHour(today, 2, 15, 30),
      allDay: false,
      location: '口腔医院',
      createdAt: created,
      updatedAt: created,
    },
    {
      id: crypto.randomUUID(),
      calendarId: birthdayId,
      title: '小明生日 🎂',
      start: atHour(today, 3, 0, 0),
      end: atHour(today, 3, 0, 0),
      allDay: true,
      recurrence: { freq: 'YEARLY', interval: 1 },
      createdAt: created,
      updatedAt: created,
    },
  ]

  return { calendars, events }
}

// —— 反序列化 (宽松文件壳 -> 强类型, 丢弃脏数据) ——
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function parseCalendar(v: unknown): Calendar | null {
  if (!isObj(v)) return null
  const { id, name, color, visible, isDefault } = v
  if (typeof id !== 'string' || typeof name !== 'string' || typeof color !== 'string') return null
  return {
    id,
    name,
    color,
    visible: visible !== false,
    isDefault: isDefault === true ? true : undefined,
  }
}

function parseRecurrence(v: unknown): Recurrence | null {
  if (!isObj(v)) return null
  const { freq, interval, until } = v
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null
  return {
    freq,
    interval: typeof interval === 'number' && interval > 0 ? Math.floor(interval) : 1,
    until: typeof until === 'string' ? until : undefined,
  }
}

function parseEvent(v: unknown): CalendarEvent | null {
  if (!isObj(v)) return null
  const { id, calendarId, title, start, end } = v
  if (
    typeof id !== 'string' ||
    typeof calendarId !== 'string' ||
    typeof start !== 'string' ||
    typeof end !== 'string'
  ) {
    return null
  }
  const created = typeof v.createdAt === 'string' ? v.createdAt : nowIso()
  return {
    id,
    calendarId,
    title: typeof title === 'string' ? title : '',
    start,
    end,
    allDay: v.allDay === true,
    location: typeof v.location === 'string' ? v.location : undefined,
    notes: typeof v.notes === 'string' ? v.notes : undefined,
    url: typeof v.url === 'string' ? v.url : undefined,
    recurrence: parseRecurrence(v.recurrence),
    createdAt: created,
    updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : created,
  }
}

// —— debounce 落盘 ——
let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(get: () => CalendarState) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    const { calendars, events } = get()
    const payload: CalendarStoreFile = {
      version: 1,
      updatedAt: nowIso(),
      calendars,
      events,
    }
    void api.saveCalendar(payload)
  }, 300)
}

export const useCalendarStore = create<CalendarState>((set, get) => {
  // 任一变更后: 触发落盘。
  const commit = (partial: Partial<Pick<CalendarState, 'calendars' | 'events'>>) => {
    set(partial)
    scheduleSave(get)
  }

  return {
    calendars: [],
    events: [],
    loaded: false,

    init: async () => {
      if (get().loaded) return
      let file: CalendarStoreFile | null = null
      try {
        file = await api.loadCalendar()
      } catch {
        file = null
      }
      const calendars = (file?.calendars ?? [])
        .map(parseCalendar)
        .filter((c): c is Calendar => c !== null)
      const events = (file?.events ?? [])
        .map(parseEvent)
        .filter((e): e is CalendarEvent => e !== null)

      // 本地无任何日历 -> 播种默认数据并立即落盘。
      if (calendars.length === 0) {
        const seeded = seedDefaults()
        set({ calendars: seeded.calendars, events: seeded.events, loaded: true })
        void api.saveCalendar({ version: 1, updatedAt: nowIso(), ...seeded })
        return
      }

      set({ calendars, events, loaded: true })
    },

    addCalendar: ({ name, color }) => {
      const cal: Calendar = { id: crypto.randomUUID(), name, color, visible: true }
      commit({ calendars: [...get().calendars, cal] })
      return cal
    },

    updateCalendar: (id, patch) => {
      commit({
        calendars: get().calendars.map((c) => (c.id === id ? { ...c, ...patch, id: c.id } : c)),
      })
    },

    removeCalendar: (id) => {
      const target = get().calendars.find((c) => c.id === id)
      // 默认日历不允许删除 (与 Apple 行为一致, 至少保留一个归属)。
      if (!target || target.isDefault) return
      commit({
        calendars: get().calendars.filter((c) => c.id !== id),
        // 同时移除该日历下的所有事件。
        events: get().events.filter((e) => e.calendarId !== id),
      })
    },

    toggleCalendarVisible: (id) => {
      commit({
        calendars: get().calendars.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)),
      })
    },

    addEvent: (input) => {
      const ts = nowIso()
      const ev: CalendarEvent = { ...input, id: crypto.randomUUID(), createdAt: ts, updatedAt: ts }
      commit({ events: [...get().events, ev] })
      return ev
    },

    updateEvent: (id, patch) => {
      commit({
        events: get().events.map((e) =>
          e.id === id ? { ...e, ...patch, id: e.id, updatedAt: nowIso() } : e,
        ),
      })
    },

    removeEvent: (id) => {
      commit({ events: get().events.filter((e) => e.id !== id) })
    },

    importEvents: (items) => {
      if (items.length === 0) return 0

      // 复用已有「导入」日历, 否则新建一个。
      const calendars = get().calendars
      let importCal = calendars.find((c) => c.name === IMPORT_CALENDAR_NAME)
      let nextCalendars = calendars
      if (!importCal) {
        importCal = {
          id: crypto.randomUUID(),
          name: IMPORT_CALENDAR_NAME,
          color: IMPORT_CALENDAR_COLOR,
          visible: true,
        }
        nextCalendars = [...calendars, importCal]
      }

      const ts = nowIso()
      const newEvents: CalendarEvent[] = items.map((it) => ({
        id: crypto.randomUUID(),
        calendarId: importCal!.id,
        title: it.title,
        start: it.start,
        end: it.end,
        allDay: it.allDay,
        location: it.location,
        notes: it.notes,
        recurrence: null,
        createdAt: ts,
        updatedAt: ts,
      }))

      commit({ calendars: nextCalendars, events: [...get().events, ...newEvents] })
      return newEvents.length
    },

    replaceAll: (data) => {
      commit({
        calendars: Array.isArray(data.calendars) ? data.calendars : [],
        events: Array.isArray(data.events) ? data.events : [],
      })
    },
  }
})
