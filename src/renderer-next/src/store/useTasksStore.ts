import { create } from 'zustand'
import { addDays, addMonths, addWeeks, addYears, format, parseISO, startOfDay } from 'date-fns'
import { api } from '@/lib/api'
import type { TasksStoreFile } from '@/types/api'

// 待办 + 备忘录 store (对齐滴答清单)。
// 持久化: api.loadTasks() / api.saveTasks() (本地文件壳, 结构由本 store 维护)。
//  - 初始化 load 一次; 首次为空则播种「收件箱」清单 + 示例任务/便签。
//  - 任意 lists/tasks/memos 变更后 debounce(~300ms) 落盘。
// 智能清单 (今天/最近7天/收件箱/全部/已完成) 不落盘, 由 selectors 计算。

// —— 数据模型 ——
export type Priority = 0 | 1 | 2 | 3 // 0 无 / 1 低 / 2 中 / 3 高

export type RepeatFreq = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface Repeat {
  freq: RepeatFreq
  interval: number
}

export interface Subtask {
  id: string
  title: string
  completed: boolean
}

export interface TaskList {
  id: string
  name: string
  color: string // hex
  isInbox?: boolean
  sortOrder: number
}

export interface Task {
  id: string
  listId: string
  title: string
  notes?: string
  priority: Priority
  tags: string[]
  dueDate?: string // 'YYYY-MM-DD'
  dueTime?: string // 'HH:mm'
  isAllDay: boolean
  repeat?: Repeat | null
  subtasks: Subtask[]
  completed: boolean
  completedAt?: string // ISO
  sortOrder: number
  // 已同步到个人日历时, 记录对应日历事件 id (再次同步则更新该事件而非重复创建)。
  calendarEventId?: string
  createdAt: string
  updatedAt: string
}

export interface Memo {
  id: string
  title?: string
  body: string
  color: string // 便签底色 hex
  pinned: boolean
  tags?: string[]
  createdAt: string
  updatedAt: string
}

// 智能清单标识 (虚拟视图, 不存)。
export type SmartView = 'today' | 'next7' | 'inbox' | 'all' | 'completed'

// 新建任务入参 (id/时间戳/默认值由 store 补齐)。
export type NewTaskInput = Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt'>> &
  Pick<Task, 'title'>

// —— 工具 ——
function nowIso(): string {
  return new Date().toISOString()
}
const todayStr = (): string => format(new Date(), 'yyyy-MM-dd')

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

// —— 默认播种 —— (首次运行, 本地无数据)
function seedDefaults(): { lists: TaskList[]; tasks: Task[]; memos: Memo[] } {
  const inboxId = crypto.randomUUID()
  const workId = crypto.randomUUID()
  const lifeId = crypto.randomUUID()
  const ts = nowIso()

  const lists: TaskList[] = [
    { id: inboxId, name: '收件箱', color: '#8e8e93', isInbox: true, sortOrder: 0 },
    { id: workId, name: '工作', color: '#3b82f6', sortOrder: 1 },
    { id: lifeId, name: '生活', color: '#34c759', sortOrder: 2 },
  ]

  const today = startOfDay(new Date())
  const mk = (over: Partial<Task> & Pick<Task, 'title' | 'listId'>): Task => ({
    id: crypto.randomUUID(),
    notes: undefined,
    priority: 0,
    tags: [],
    isAllDay: true,
    repeat: null,
    subtasks: [],
    completed: false,
    sortOrder: 0,
    createdAt: ts,
    updatedAt: ts,
    ...over,
  })

  const tasks: Task[] = [
    mk({
      listId: workId,
      title: '提交周报',
      priority: 3,
      tags: ['工作'],
      dueDate: todayStr(),
      dueTime: '18:00',
      isAllDay: false,
      sortOrder: 0,
    }),
    mk({
      listId: lifeId,
      title: '取快递',
      priority: 1,
      dueDate: format(addDays(today, -1), 'yyyy-MM-dd'), // 逾期
      sortOrder: 1,
    }),
    mk({
      listId: workId,
      title: '项目评审会',
      priority: 2,
      dueDate: format(addDays(today, 6), 'yyyy-MM-dd'), // 下周
      dueTime: '14:30',
      isAllDay: false,
      subtasks: [
        { id: crypto.randomUUID(), title: '准备演示', completed: false },
        { id: crypto.randomUUID(), title: '整理数据', completed: true },
      ],
      sortOrder: 2,
    }),
    mk({
      listId: inboxId,
      title: '随手记: 想读的书清单',
      sortOrder: 3,
    }),
  ]

  const memos: Memo[] = [
    {
      id: crypto.randomUUID(),
      title: '欢迎使用备忘录',
      body: '点击便签即可编辑。\n右上角图钉可以置顶。\n支持多种便签颜色。',
      color: '#fef7cd',
      pinned: true,
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: crypto.randomUUID(),
      title: '灵感',
      body: '在快速添加里试试:\n明天下午5点写周报 !high #工作',
      color: '#d8f5d3',
      pinned: false,
      tags: ['提示'],
      createdAt: ts,
      updatedAt: ts,
    },
  ]

  return { lists, tasks, memos }
}

// —— 反序列化 (宽松文件壳 -> 强类型) ——
function parseList(v: unknown, idx: number): TaskList | null {
  if (!isObj(v)) return null
  const { id, name, color } = v
  if (typeof id !== 'string' || typeof name !== 'string') return null
  return {
    id,
    name,
    color: typeof color === 'string' ? color : '#8e8e93',
    isInbox: v.isInbox === true ? true : undefined,
    sortOrder: typeof v.sortOrder === 'number' ? v.sortOrder : idx,
  }
}

function parsePriority(v: unknown): Priority {
  return v === 1 || v === 2 || v === 3 ? v : 0
}

function parseRepeat(v: unknown): Repeat | null {
  if (!isObj(v)) return null
  const { freq, interval } = v
  if (freq !== 'daily' && freq !== 'weekly' && freq !== 'monthly' && freq !== 'yearly') return null
  return { freq, interval: typeof interval === 'number' && interval > 0 ? Math.floor(interval) : 1 }
}

function parseSubtasks(v: unknown): Subtask[] {
  if (!Array.isArray(v)) return []
  const out: Subtask[] = []
  for (const it of v) {
    if (!isObj(it)) continue
    if (typeof it.id !== 'string' || typeof it.title !== 'string') continue
    out.push({ id: it.id, title: it.title, completed: it.completed === true })
  }
  return out
}

function parseTask(v: unknown, idx: number): Task | null {
  if (!isObj(v)) return null
  const { id, listId, title } = v
  if (typeof id !== 'string' || typeof listId !== 'string' || typeof title !== 'string') return null
  const created = typeof v.createdAt === 'string' ? v.createdAt : nowIso()
  return {
    id,
    listId,
    title,
    notes: typeof v.notes === 'string' ? v.notes : undefined,
    priority: parsePriority(v.priority),
    tags: Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === 'string') : [],
    dueDate: typeof v.dueDate === 'string' ? v.dueDate : undefined,
    dueTime: typeof v.dueTime === 'string' ? v.dueTime : undefined,
    isAllDay: v.isAllDay !== false,
    repeat: parseRepeat(v.repeat),
    subtasks: parseSubtasks(v.subtasks),
    completed: v.completed === true,
    completedAt: typeof v.completedAt === 'string' ? v.completedAt : undefined,
    calendarEventId: typeof v.calendarEventId === 'string' ? v.calendarEventId : undefined,
    sortOrder: typeof v.sortOrder === 'number' ? v.sortOrder : idx,
    createdAt: created,
    updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : created,
  }
}

function parseMemo(v: unknown): Memo | null {
  if (!isObj(v)) return null
  const { id, body } = v
  if (typeof id !== 'string') return null
  const created = typeof v.createdAt === 'string' ? v.createdAt : nowIso()
  return {
    id,
    title: typeof v.title === 'string' ? v.title : undefined,
    body: typeof body === 'string' ? body : '',
    color: typeof v.color === 'string' ? v.color : '#fff3bf',
    pinned: v.pinned === true,
    tags: Array.isArray(v.tags)
      ? v.tags.filter((t): t is string => typeof t === 'string')
      : undefined,
    createdAt: created,
    updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : created,
  }
}

// —— 重复任务: 完成时按规则推进到下一周期 ——
function advanceDate(dateStr: string, repeat: Repeat): string {
  const d = parseISO(dateStr)
  const n = repeat.interval
  let next: Date
  switch (repeat.freq) {
    case 'daily':
      next = addDays(d, n)
      break
    case 'weekly':
      next = addWeeks(d, n)
      break
    case 'monthly':
      next = addMonths(d, n)
      break
    case 'yearly':
      next = addYears(d, n)
      break
  }
  return format(next, 'yyyy-MM-dd')
}

// —— debounce 落盘 ——
let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(get: () => TasksState) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    const { lists, tasks, memos } = get()
    const payload: TasksStoreFile = { version: 1, updatedAt: nowIso(), lists, tasks, memos }
    void api.saveTasks(payload)
  }, 300)
}

interface TasksState {
  lists: TaskList[]
  tasks: Task[]
  memos: Memo[]
  loaded: boolean

  init: () => Promise<void>

  // 清单 CRUD
  addList: (input: { name: string; color: string }) => TaskList
  updateList: (id: string, patch: Partial<Omit<TaskList, 'id' | 'isInbox'>>) => void
  removeList: (id: string) => void
  inboxId: () => string

  // 任务 CRUD
  addTask: (input: NewTaskInput) => Task
  updateTask: (id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>) => void
  removeTask: (id: string) => void
  toggleTask: (id: string) => void // 完成/取消 (含重复任务再生)
  reorderTasks: (ids: string[]) => void // P1: 拖拽排序 (按给定顺序写 sortOrder)

  // 子任务
  addSubtask: (taskId: string, title: string) => void
  toggleSubtask: (taskId: string, subId: string) => void
  removeSubtask: (taskId: string, subId: string) => void

  // 备忘录 CRUD
  addMemo: (input?: Partial<Memo>) => Memo
  updateMemo: (id: string, patch: Partial<Omit<Memo, 'id' | 'createdAt'>>) => void
  removeMemo: (id: string) => void
  toggleMemoPin: (id: string) => void

  // 用(云端合并后的)整组数据替换本地 (云同步用); 会触发本地落盘。
  replaceAll: (data: { lists: TaskList[]; tasks: Task[]; memos: Memo[] }) => void
}

export const useTasksStore = create<TasksState>((set, get) => {
  const commit = (partial: Partial<Pick<TasksState, 'lists' | 'tasks' | 'memos'>>) => {
    set(partial)
    scheduleSave(get)
  }

  return {
    lists: [],
    tasks: [],
    memos: [],
    loaded: false,

    init: async () => {
      if (get().loaded) return
      let file: TasksStoreFile | null
      try {
        file = await api.loadTasks()
      } catch {
        file = null
      }
      const lists = (file?.lists ?? [])
        .map((v, i) => parseList(v, i))
        .filter((l): l is TaskList => l !== null)
      const tasks = (file?.tasks ?? [])
        .map((v, i) => parseTask(v, i))
        .filter((t): t is Task => t !== null)
      const memos = (file?.memos ?? []).map(parseMemo).filter((m): m is Memo => m !== null)

      // 没有任何清单 (或没有收件箱) -> 播种默认并落盘。
      if (lists.length === 0) {
        const seeded = seedDefaults()
        set({ ...seeded, loaded: true })
        void api.saveTasks({ version: 1, updatedAt: nowIso(), ...seeded })
        return
      }

      set({ lists, tasks, memos, loaded: true })
    },

    inboxId: () => {
      const inbox = get().lists.find((l) => l.isInbox)
      return inbox?.id ?? get().lists[0]?.id ?? ''
    },

    addList: ({ name, color }) => {
      const order = get().lists.reduce((m, l) => Math.max(m, l.sortOrder), -1) + 1
      const list: TaskList = { id: crypto.randomUUID(), name, color, sortOrder: order }
      commit({ lists: [...get().lists, list] })
      return list
    },

    updateList: (id, patch) => {
      commit({
        lists: get().lists.map((l) => (l.id === id ? { ...l, ...patch, id: l.id } : l)),
      })
    },

    removeList: (id) => {
      const target = get().lists.find((l) => l.id === id)
      if (!target || target.isInbox) return // 收件箱不可删
      const fallback = get().inboxId()
      commit({
        lists: get().lists.filter((l) => l.id !== id),
        // 该清单下的任务移回收件箱, 不直接删除, 避免误丢。
        tasks: get().tasks.map((t) => (t.listId === id ? { ...t, listId: fallback } : t)),
      })
    },

    addTask: (input) => {
      const ts = nowIso()
      const order = get().tasks.reduce((m, t) => Math.max(m, t.sortOrder), -1) + 1
      const task: Task = {
        listId: input.listId ?? get().inboxId(),
        title: input.title,
        notes: input.notes,
        priority: input.priority ?? 0,
        tags: input.tags ?? [],
        dueDate: input.dueDate,
        dueTime: input.dueTime,
        isAllDay: input.isAllDay ?? !input.dueTime,
        repeat: input.repeat ?? null,
        subtasks: input.subtasks ?? [],
        completed: input.completed ?? false,
        completedAt: input.completedAt,
        sortOrder: input.sortOrder ?? order,
        id: crypto.randomUUID(),
        createdAt: ts,
        updatedAt: ts,
      }
      commit({ tasks: [...get().tasks, task] })
      return task
    },

    updateTask: (id, patch) => {
      commit({
        tasks: get().tasks.map((t) =>
          t.id === id ? { ...t, ...patch, id: t.id, updatedAt: nowIso() } : t,
        ),
      })
    },

    removeTask: (id) => {
      commit({ tasks: get().tasks.filter((t) => t.id !== id) })
    },

    toggleTask: (id) => {
      const task = get().tasks.find((t) => t.id === id)
      if (!task) return
      const ts = nowIso()

      // 取消完成: 直接置回未完成。
      if (task.completed) {
        commit({
          tasks: get().tasks.map((t) =>
            t.id === id ? { ...t, completed: false, completedAt: undefined, updatedAt: ts } : t,
          ),
        })
        return
      }

      // 完成: 若是重复任务且有到期日 -> 原任务推进到下一周期(保持未完成),
      // 同时落一条已完成的历史副本; 否则普通标记完成。
      if (task.repeat && task.dueDate) {
        const nextDate = advanceDate(task.dueDate, task.repeat)
        const historyId = crypto.randomUUID()
        const history: Task = {
          ...task,
          id: historyId,
          repeat: null,
          completed: true,
          completedAt: ts,
          updatedAt: ts,
        }
        commit({
          tasks: [
            ...get().tasks.map((t) =>
              t.id === id ? { ...t, dueDate: nextDate, updatedAt: ts } : t,
            ),
            history,
          ],
        })
        return
      }

      commit({
        tasks: get().tasks.map((t) =>
          t.id === id ? { ...t, completed: true, completedAt: ts, updatedAt: ts } : t,
        ),
      })
    },

    reorderTasks: (ids) => {
      const order = new Map(ids.map((id, i) => [id, i]))
      commit({
        tasks: get().tasks.map((t) =>
          order.has(t.id) ? { ...t, sortOrder: order.get(t.id)!, updatedAt: t.updatedAt } : t,
        ),
      })
    },

    addSubtask: (taskId, title) => {
      const sub: Subtask = { id: crypto.randomUUID(), title, completed: false }
      commit({
        tasks: get().tasks.map((t) =>
          t.id === taskId ? { ...t, subtasks: [...t.subtasks, sub], updatedAt: nowIso() } : t,
        ),
      })
    },

    toggleSubtask: (taskId, subId) => {
      commit({
        tasks: get().tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                subtasks: t.subtasks.map((s) =>
                  s.id === subId ? { ...s, completed: !s.completed } : s,
                ),
                updatedAt: nowIso(),
              }
            : t,
        ),
      })
    },

    removeSubtask: (taskId, subId) => {
      commit({
        tasks: get().tasks.map((t) =>
          t.id === taskId
            ? { ...t, subtasks: t.subtasks.filter((s) => s.id !== subId), updatedAt: nowIso() }
            : t,
        ),
      })
    },

    addMemo: (input) => {
      const ts = nowIso()
      const memo: Memo = {
        id: crypto.randomUUID(),
        title: input?.title,
        body: input?.body ?? '',
        color: input?.color ?? '#fff3bf',
        pinned: input?.pinned ?? false,
        tags: input?.tags,
        createdAt: ts,
        updatedAt: ts,
      }
      commit({ memos: [memo, ...get().memos] })
      return memo
    },

    updateMemo: (id, patch) => {
      commit({
        memos: get().memos.map((m) =>
          m.id === id ? { ...m, ...patch, id: m.id, updatedAt: nowIso() } : m,
        ),
      })
    },

    removeMemo: (id) => {
      commit({ memos: get().memos.filter((m) => m.id !== id) })
    },

    toggleMemoPin: (id) => {
      commit({
        memos: get().memos.map((m) =>
          m.id === id ? { ...m, pinned: !m.pinned, updatedAt: nowIso() } : m,
        ),
      })
    },

    replaceAll: (data) => {
      commit({
        lists: Array.isArray(data.lists) ? data.lists : [],
        tasks: Array.isArray(data.tasks) ? data.tasks : [],
        memos: Array.isArray(data.memos) ? data.memos : [],
      })
    },
  }
})

// ============================================================
//  智能清单 selectors (纯函数, 不落盘)。组件用 useTasksStore(...) 取 tasks 后调用。
// ============================================================

// 任务到期日的语义分组 key (用于带分组头的列表渲染)。
export type DueGroup = 'overdue' | 'today' | 'tomorrow' | 'next7' | 'later' | 'none'

export const DUE_GROUP_LABELS: Record<DueGroup, string> = {
  overdue: '逾期',
  today: '今天',
  tomorrow: '明天',
  next7: '最近7天',
  later: '以后',
  none: '无日期',
}

export const DUE_GROUP_ORDER: DueGroup[] = [
  'overdue',
  'today',
  'tomorrow',
  'next7',
  'later',
  'none',
]

// 计算某任务的到期分组 (相对今天)。
export function dueGroupOf(task: Task, today: Date = startOfDay(new Date())): DueGroup {
  if (!task.dueDate) return 'none'
  const due = startOfDay(parseISO(task.dueDate))
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000)
  if (diff < 0) return 'overdue'
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff <= 6) return 'next7'
  return 'later'
}

// 任务排序: 先按 sortOrder, 再按到期 (有日期靠前), 末按创建时间。
function compareTasks(a: Task, b: Task): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  const ad = a.dueDate ?? '9999-99-99'
  const bd = b.dueDate ?? '9999-99-99'
  if (ad !== bd) return ad < bd ? -1 : 1
  return a.createdAt < b.createdAt ? -1 : 1
}

// 智能视图过滤: 返回符合该视图的任务 (未排序)。
export function selectByView(tasks: Task[], view: SmartView, inboxId: string): Task[] {
  const today = todayStr()
  switch (view) {
    case 'today':
      return tasks.filter((t) => !t.completed && t.dueDate && t.dueDate <= today)
    case 'next7': {
      const limit = format(addDays(new Date(), 6), 'yyyy-MM-dd')
      return tasks.filter(
        (t) => !t.completed && t.dueDate && t.dueDate >= today && t.dueDate <= limit,
      )
    }
    case 'inbox':
      return tasks.filter((t) => !t.completed && t.listId === inboxId)
    case 'all':
      return tasks.filter((t) => !t.completed)
    case 'completed':
      return tasks.filter((t) => t.completed)
  }
}

// 用户清单过滤 (按 listId, 仅未完成)。
export function selectByList(tasks: Task[], listId: string): Task[] {
  return tasks.filter((t) => !t.completed && t.listId === listId)
}

// 把任务列表按到期分组并排序, 返回有序的分组数组 (空组省略)。
export function groupByDue(tasks: Task[]): { group: DueGroup; tasks: Task[] }[] {
  const today = startOfDay(new Date())
  const buckets = new Map<DueGroup, Task[]>()
  for (const t of tasks) {
    const g = dueGroupOf(t, today)
    const arr = buckets.get(g) ?? []
    arr.push(t)
    buckets.set(g, arr)
  }
  const result: { group: DueGroup; tasks: Task[] }[] = []
  for (const g of DUE_GROUP_ORDER) {
    const arr = buckets.get(g)
    if (arr && arr.length) result.push({ group: g, tasks: [...arr].sort(compareTasks) })
  }
  return result
}

// 已完成视图: 按完成时间倒序。
export function sortCompleted(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const ac = a.completedAt ?? a.updatedAt
    const bc = b.completedAt ?? b.updatedAt
    return ac < bc ? 1 : ac > bc ? -1 : 0
  })
}

// 智能视图未完成计数 (用于左栏徽标)。
export function smartCount(tasks: Task[], view: SmartView, inboxId: string): number {
  return selectByView(tasks, view, inboxId).length
}

// 普通排序导出 (供清单视图在不分组时使用)。
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(compareTasks)
}
