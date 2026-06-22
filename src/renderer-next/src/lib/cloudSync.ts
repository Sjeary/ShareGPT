import { create } from 'zustand'
import { useCalendarStore, type Calendar, type CalendarEvent } from '@/store/useCalendarStore'
import { useTasksStore, type Memo, type Task, type TaskList } from '@/store/useTasksStore'

// 个人数据云端同步 (个人日历 calendar / 待办备忘 tasks):
//  - 多端实时: 写入经服务器后, 服务器把更新推给同一用户的其它在线端。
//  - 防止老版本覆盖新版本: 服务器用单调 rev 做乐观并发, 客户端写入须带 baseRev; 不匹配 -> 409,
//    客户端先合并服务器最新再重试。
//  - 合并策略: 按条目 id 合并; 带 updatedAt 的条目(事件/任务/便签)取较新者; 配置类(日历/清单)本地优先并入。
//  - 未登录 / 服务器不支持该接口 -> 静默降级为纯本地 (功能不受影响)。

export type SyncState = 'off' | 'local' | 'syncing' | 'synced' | 'error'
export type SyncKind = 'calendar' | 'tasks'

interface SyncStatusState {
  calendar: SyncState
  tasks: SyncState
  setState: (kind: SyncKind, s: SyncState) => void
}

// 同步状态 (供面板顶部小指示器读取)。
export const useSyncStatus = create<SyncStatusState>((set) => ({
  calendar: 'off',
  tasks: 'off',
  setState: (kind, s) => set({ [kind]: s } as Partial<SyncStatusState>),
}))

// —— 合并 ——
function mergeByIdNewer<T extends { id: string; updatedAt?: string }>(
  local: T[],
  remote: T[],
): T[] {
  const map = new Map<string, T>()
  for (const it of remote) if (it && it.id) map.set(it.id, it)
  for (const it of local) {
    if (!it || !it.id) continue
    const ex = map.get(it.id)
    // 同 id: updatedAt 较新者胜 (本地不更早则保留本地)。
    if (!ex || (it.updatedAt ?? '') >= (ex.updatedAt ?? '')) map.set(it.id, it)
  }
  return [...map.values()]
}

// 配置类(无 updatedAt): 并集, 同 id 时本地优先 (保留本机的可见性/命名等)。
function mergeByIdKeepLocal<T extends { id: string }>(local: T[], remote: T[]): T[] {
  const map = new Map<string, T>()
  for (const it of remote) if (it && it.id) map.set(it.id, it)
  for (const it of local) if (it && it.id) map.set(it.id, it)
  return [...map.values()]
}

export interface CalendarData {
  calendars: Calendar[]
  events: CalendarEvent[]
}
export interface TasksData {
  lists: TaskList[]
  tasks: Task[]
  memos: Memo[]
}

function asArr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

// —— 每种数据的本地读取 / 应用 / 合并 / 订阅 ——
export interface KindConfig<D> {
  getLocal: () => D
  apply: (data: D) => void
  merge: (local: D, remote: unknown) => D
  subscribe: (fn: () => void) => () => void
  isLoaded: () => boolean
}

export const KIND_CONFIGS: { calendar: KindConfig<CalendarData>; tasks: KindConfig<TasksData> } = {
  calendar: {
    getLocal: () => {
      const s = useCalendarStore.getState()
      return { calendars: s.calendars, events: s.events }
    },
    apply: (data) => useCalendarStore.getState().replaceAll(data),
    merge: (local, remote) => {
      const r = (remote ?? {}) as Partial<CalendarData>
      return {
        calendars: mergeByIdKeepLocal(local.calendars, asArr<Calendar>(r.calendars)),
        events: mergeByIdNewer(local.events, asArr<CalendarEvent>(r.events)),
      }
    },
    subscribe: (fn) => useCalendarStore.subscribe(fn),
    isLoaded: () => useCalendarStore.getState().loaded,
  },
  tasks: {
    getLocal: () => {
      const s = useTasksStore.getState()
      return { lists: s.lists, tasks: s.tasks, memos: s.memos }
    },
    apply: (data) => useTasksStore.getState().replaceAll(data),
    merge: (local, remote) => {
      const r = (remote ?? {}) as Partial<TasksData>
      return {
        lists: mergeByIdKeepLocal(local.lists, asArr<TaskList>(r.lists)),
        tasks: mergeByIdNewer(local.tasks, asArr<Task>(r.tasks)),
        memos: mergeByIdNewer(local.memos, asArr<Memo>(r.memos)),
      }
    },
    subscribe: (fn) => useTasksStore.subscribe(fn),
    isLoaded: () => useTasksStore.getState().loaded,
  },
}

// 稳定序列化 (用于比较是否有变化, 避免无谓推送 / 回环)。
export function stable(data: unknown): string {
  try {
    return JSON.stringify(data)
  } catch {
    return ''
  }
}

// rev 持久化 (按 服务器+用户+kind), 跨重启记住上次版本, 减少冲突。
export function revKey(serverUrl: string, username: string, kind: SyncKind): string {
  return `cloudsync:rev:${serverUrl}:${username}:${kind}`
}
export function getStoredRev(serverUrl: string, username: string, kind: SyncKind): number {
  try {
    const v = Number(localStorage.getItem(revKey(serverUrl, username, kind)))
    return Number.isInteger(v) && v >= 0 ? v : 0
  } catch {
    return 0
  }
}
export function setStoredRev(
  serverUrl: string,
  username: string,
  kind: SyncKind,
  rev: number,
): void {
  try {
    localStorage.setItem(revKey(serverUrl, username, kind), String(rev))
  } catch {
    /* ignore */
  }
}
