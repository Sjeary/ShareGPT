import { create } from 'zustand'
import { api } from '@/lib/api'
import { coalesceInFlight } from '@/lib/inFlightRequest'
import type { CalendarStoreFile } from '@/types/api'
import { createPrincipalDebouncedSave } from '@/lib/principalDebouncedSave'
import {
  settingsPrincipalRuntime,
  type SettingsPrincipalSnapshot,
} from '@/lib/settingsPrincipalRuntime'
import {
  filterDeleted,
  isDeleted,
  markDeleted,
  mergeDeletions,
  type StoreDeletions,
} from '@/lib/storeDeletions'

// 个人日历 store。
// 数据持久化: api.loadCalendar() / api.saveCalendar() (本地文件壳, 结构由本 store 维护)。
//  - 初始化时 load 一次; 首次为空只创建默认个人日历。
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
  deleted: StoreDeletions
  loaded: boolean
  loading: boolean
  loadError: string

  // 生命周期
  init: () => Promise<void>
  resetForPrincipal: () => void
  flushPending: () => Promise<void>

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
  replaceAll: (
    data: {
      calendars: Calendar[]
      events: CalendarEvent[]
      deleted?: StoreDeletions
    },
    snapshot?: SettingsPrincipalSnapshot,
  ) => void
}

// 专用「导入」日历的固定名称与颜色 (青色, 与其它默认日历区分)。
const IMPORT_CALENDAR_NAME = '导入'
const IMPORT_CALENDAR_COLOR = '#14b8a6'

// —— 默认播种 —— (首次运行, 本地无数据时)
function nowIso(): string {
  return new Date().toISOString()
}

function seedDefaults(): { calendars: Calendar[]; events: CalendarEvent[] } {
  return {
    calendars: [
      { id: 'default-personal', name: '个人', color: '#3b82f6', visible: true, isDefault: true },
    ],
    events: [],
  }
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

export const useCalendarStore = create<CalendarState>((set, get) => {
  let owner: SettingsPrincipalSnapshot | null = null
  let loadEpoch = 0
  const initializations = new Map<string, Promise<void>>()
  const persistence = createPrincipalDebouncedSave<CalendarStoreFile & { deleted: StoreDeletions }>(
    (payload) => api.saveCalendar(payload),
  )
  const scheduleSave = () => {
    if (!owner) return
    settingsPrincipalRuntime.assertCurrent(owner)
    const { calendars, events, deleted } = get()
    persistence.schedule({ version: 1, updatedAt: nowIso(), calendars, events, deleted }, owner)
  }

  // 任一变更后: 触发落盘。
  const commit = (partial: Partial<Pick<CalendarState, 'calendars' | 'events' | 'deleted'>>) => {
    if (owner) settingsPrincipalRuntime.assertCurrent(owner)
    set(partial)
    scheduleSave()
  }

  return {
    calendars: [],
    events: [],
    deleted: {},
    loaded: false,
    loading: false,
    loadError: '',

    resetForPrincipal: () => {
      loadEpoch += 1
      owner = null
      persistence.cancel()
      initializations.clear()
      set({ calendars: [], events: [], deleted: {}, loaded: false, loading: false, loadError: '' })
    },
    flushPending: () => persistence.flushPending(),

    init: async () => {
      const snapshot = settingsPrincipalRuntime.snapshot()
      if (
        get().loaded &&
        owner?.principalId === snapshot.principalId &&
        owner?.generation === snapshot.generation
      )
        return
      set({ loaded: false, loading: true, loadError: '' })
      return coalesceInFlight(
        initializations,
        JSON.stringify([snapshot.principalId, snapshot.generation]),
        async () => {
          const starting = settingsPrincipalRuntime.current()
          if (
            starting.principalId !== snapshot.principalId ||
            starting.generation !== snapshot.generation
          )
            return
          owner = snapshot
          const epoch = ++loadEpoch
          const isCurrent = () => {
            const current = settingsPrincipalRuntime.current()
            return (
              epoch === loadEpoch &&
              current.principalId === snapshot.principalId &&
              current.generation === snapshot.generation
            )
          }
          let file: CalendarStoreFile | null
          try {
            file = await api.loadCalendar()
          } catch {
            if (isCurrent())
              set({
                loading: false,
                loadError:
                  '无法读取个人日历，原有资料已保留。请检查文件访问权限或恢复有效备份后重试。',
              })
            return
          }
          if (!isCurrent()) return
          const deleted = mergeDeletions((file as { deleted?: unknown } | null)?.deleted)
          const calendars = filterDeleted(
            (file?.calendars ?? []).map(parseCalendar).filter((c): c is Calendar => c !== null),
            deleted,
            'calendars',
          )
          const events = filterDeleted(
            (file?.events ?? []).map(parseEvent).filter((e): e is CalendarEvent => e !== null),
            deleted,
            'events',
          ).filter((event) => !isDeleted(deleted, 'calendars', event.calendarId))

          // 本地无任何日历 -> 播种默认数据并立即落盘。
          if (calendars.length === 0) {
            const seeded = seedDefaults()
            const data = { calendars: seeded.calendars, events, deleted }
            set({ ...data, loaded: true, loading: false, loadError: '' })
            scheduleSave()
            await persistence.flushPending()
            return
          }

          set({ calendars, events, deleted, loaded: true, loading: false, loadError: '' })
        },
      )
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
      const removedEvents = get()
        .events.filter((event) => event.calendarId === id)
        .map((event) => event.id)
      commit({
        deleted: markDeleted(
          markDeleted(get().deleted, 'calendars', [id]),
          'events',
          removedEvents,
        ),
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
      if (!get().events.some((event) => event.id === id)) return
      commit({
        events: get().events.filter((e) => e.id !== id),
        deleted: markDeleted(get().deleted, 'events', [id]),
      })
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

    replaceAll: (data, snapshot = settingsPrincipalRuntime.snapshot()) => {
      settingsPrincipalRuntime.assertCurrent(snapshot)
      if (owner) settingsPrincipalRuntime.assertCurrent(owner)
      const deleted = mergeDeletions(get().deleted, data.deleted)
      commit({
        calendars: filterDeleted(
          Array.isArray(data.calendars) ? data.calendars : [],
          deleted,
          'calendars',
        ),
        events: filterDeleted(
          Array.isArray(data.events) ? data.events : [],
          deleted,
          'events',
        ).filter((event) => !isDeleted(deleted, 'calendars', event.calendarId)),
        deleted,
      })
    },
  }
})
