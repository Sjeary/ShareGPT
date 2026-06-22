// 跨功能集成层: 把「待办 / 个人日历 / 组队日历 / 协作聊天」串起来。
// 全部通过各 store 的 getState() 在运行时调用, 不在组件间产生耦合 import 链。
import { useChatStore } from '@/store/useChatStore'
import { useCalendarStore } from '@/store/useCalendarStore'
import { useTasksStore, type Task } from '@/store/useTasksStore'
import { useTeamCalendarStore, type TeamEvent, type RsvpStatus } from '@/store/useTeamCalendarStore'

// ============================================================
//  待办 -> 个人日历 (单条同步 / 一键同步)
// ============================================================

// 同步进来的任务统一放进一个「待办」日历, 与其它日历用颜色区分。
const TODO_CALENDAR_NAME = '待办'
const TODO_CALENDAR_COLOR = '#a855f7' // 紫色

function ensureTodoCalendarId(): string {
  const cal = useCalendarStore.getState()
  const found = cal.calendars.find((c) => c.name === TODO_CALENDAR_NAME)
  if (found) return found.id
  return cal.addCalendar({ name: TODO_CALENDAR_NAME, color: TODO_CALENDAR_COLOR }).id
}

// 由任务的到期日/时间推导日历事件的起止 (无到期日返回 null)。
function taskToTimes(task: Task): { start: string; end: string; allDay: boolean } | null {
  if (!task.dueDate) return null
  if (task.isAllDay || !task.dueTime) {
    const start = new Date(`${task.dueDate}T00:00:00`)
    const end = new Date(start)
    end.setDate(end.getDate() + 1) // 全天事件占满当天
    return { start: start.toISOString(), end: end.toISOString(), allDay: true }
  }
  const start = new Date(`${task.dueDate}T${task.dueTime}:00`)
  const end = new Date(start.getTime() + 60 * 60 * 1000) // 默认 1 小时
  return { start: start.toISOString(), end: end.toISOString(), allDay: false }
}

export type SyncTaskResult = 'synced' | 'updated' | 'no-date' | 'not-found'

// 单条任务同步到个人日历。已关联事件且仍存在 -> 更新; 否则新建并回写 calendarEventId。
export function syncTaskToCalendar(taskId: string): SyncTaskResult {
  const tasks = useTasksStore.getState()
  const task = tasks.tasks.find((t) => t.id === taskId)
  if (!task) return 'not-found'
  const times = taskToTimes(task)
  if (!times) return 'no-date'

  const cal = useCalendarStore.getState()
  const notes = `来自待办${task.notes ? `\n${task.notes}` : ''}`

  if (task.calendarEventId && cal.events.some((e) => e.id === task.calendarEventId)) {
    cal.updateEvent(task.calendarEventId, { title: task.title, ...times, notes })
    return 'updated'
  }
  const calendarId = ensureTodoCalendarId()
  const ev = cal.addEvent({
    calendarId,
    title: task.title,
    start: times.start,
    end: times.end,
    allDay: times.allDay,
    notes,
    recurrence: null,
  })
  tasks.updateTask(taskId, { calendarEventId: ev.id })
  return 'synced'
}

// 一键: 把所有「未完成且有到期日」的任务同步到个人日历, 返回成功数量。
export function syncAllTasksToCalendar(): number {
  const tasks = useTasksStore.getState().tasks.filter((t) => !t.completed && t.dueDate)
  let n = 0
  for (const t of tasks) {
    const r = syncTaskToCalendar(t.id)
    if (r === 'synced' || r === 'updated') n += 1
  }
  return n
}

// 当前有多少未完成且有到期日的任务可同步 (供按钮显示数量)。
export function syncableTaskCount(): number {
  return useTasksStore.getState().tasks.filter((t) => !t.completed && t.dueDate).length
}

// ============================================================
//  个人日历事件 -> 组队(共享)日历
// ============================================================

const TEAM_LOCAL_KEY = 'team-calendar:local-events' // 与 useTeamCalendar 的本地降级 key 保持一致

export interface ShareToTeamInput {
  title: string
  start: string
  end: string
  allDay: boolean
  location?: string
  description?: string
  color?: string
}

// 把一条事件共享到组队日历。
//  - 立即写入 team store + 本地降级存储 (即使团队面板未打开也不丢、可见)。
//  - 已登录协作服务器时, 额外尽力 POST 到服务器 (失败忽略, 本地已可见)。
export function shareEventToTeam(input: ShareToTeamInput): TeamEvent {
  const { username, displayName, serverUrl, token } = useChatStore.getState().identity
  const organizer = username || '我'
  const now = new Date().toISOString()
  const loggedIn = Boolean(serverUrl && token)

  const event: TeamEvent = {
    id: crypto.randomUUID(),
    subnetKey: loggedIn ? '' : 'local',
    title: input.title,
    description: input.description,
    location: input.location,
    start: input.start,
    end: input.end,
    allDay: input.allDay,
    organizer,
    attendees: [
      { username: organizer, displayName: displayName || organizer, rsvp: 'accept' as RsvpStatus },
    ],
    color: input.color,
    createdBy: organizer,
    createdAt: now,
    updatedAt: now,
  }

  // 1) 写入内存 store (团队日历界面立即可见)。
  useTeamCalendarStore.getState().upsert(event)

  // 2) 持久化到本地降级存储 (团队面板未挂载时其副作用不会跑, 这里兜底)。
  try {
    const raw = localStorage.getItem(TEAM_LOCAL_KEY)
    const list = raw ? JSON.parse(raw) : []
    if (Array.isArray(list)) {
      list.push(event)
      localStorage.setItem(TEAM_LOCAL_KEY, JSON.stringify(list))
    }
  } catch {
    /* 配额/隐私模式失败可忽略 */
  }

  // 3) 已登录: 尽力推到服务器, 成功则用服务端返回(带真实 subnetKey)覆盖本地这条。
  if (loggedIn) {
    void fetch(`${serverUrl}/api/team-calendar/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        title: input.title,
        description: input.description,
        location: input.location,
        start: input.start,
        end: input.end,
        allDay: input.allDay,
        color: input.color,
        attendees: [],
      }),
    })
      .then(async (res) => {
        if (!res.ok) return
        const data = (await res.json().catch(() => null)) as { event?: TeamEvent } | null
        if (data?.event) useTeamCalendarStore.getState().upsert(data.event)
      })
      .catch(() => {
        /* 服务端不支持/网络失败: 本地已可见, 忽略 */
      })
  }

  return event
}

// ============================================================
//  发送到协作聊天 (把事件/任务作为一条消息分享给团队)
//  说明: 仅在已登录且聊天 WS 已连接时可用; 通过全局注册的发送器发出。
// ============================================================

type ChatSender = (text: string) => void
let chatSender: ChatSender | null = null

// 由聊天面板/hook 在挂载时注册其发送函数 (room 广播)。
export function registerChatSender(fn: ChatSender | null): void {
  chatSender = fn
}

export function canSendToChat(): boolean {
  const { serverUrl, token } = useChatStore.getState().identity
  return Boolean(serverUrl && token) && typeof chatSender === 'function'
}

export function sendToChat(text: string): boolean {
  if (!chatSender) return false
  try {
    chatSender(text)
    return true
  } catch {
    return false
  }
}
