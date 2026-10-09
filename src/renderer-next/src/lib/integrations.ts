// 跨功能集成层: 把「待办 / 个人日历 / 组队日历 / 协作聊天」串起来。
// 全部通过各 store 的 getState() 在运行时调用, 不在组件间产生耦合 import 链。
import { settingsPrincipalRuntime } from '@/lib/settingsPrincipalRuntime'
import { coalesceInFlight } from '@/lib/inFlightRequest'
import { useChatStore } from '@/store/useChatStore'
import { useCalendarStore } from '@/store/useCalendarStore'
import { useTasksStore, type Task } from '@/store/useTasksStore'
import type { TeamEvent } from '@/store/useTeamCalendarStore'
import { createTeamCalendarClient } from '@/lib/teamCalendarClient'

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
const taskSyncs = new Map<string, Promise<SyncTaskResult>>()
// 日历保存失败时保留事件身份供本代次重试，避免再次点击创建重复事件。
const pendingTaskLinks = new Map<string, { ownerKey: string; eventId: string }>()

export function syncTaskToCalendar(taskId: string): Promise<SyncTaskResult> {
  const snapshot = settingsPrincipalRuntime.snapshot()
  const ownerKey = JSON.stringify(snapshot)
  const operationKey = JSON.stringify([ownerKey, taskId])
  for (const [key, pending] of pendingTaskLinks) {
    if (pending.ownerKey !== ownerKey) pendingTaskLinks.delete(key)
  }
  return coalesceInFlight(taskSyncs, operationKey, async () => {
    settingsPrincipalRuntime.assertCurrent(snapshot)
    await Promise.all([useTasksStore.getState().init(), useCalendarStore.getState().init()])
    settingsPrincipalRuntime.assertCurrent(snapshot)
    const tasks = useTasksStore.getState()
    const cal = useCalendarStore.getState()
    if (!tasks.loaded || !cal.loaded)
      throw new Error(tasks.loadError || cal.loadError || '本机资料尚未加载')
    const task = tasks.tasks.find((t) => t.id === taskId)
    if (!task) return 'not-found'
    const times = taskToTimes(task)
    if (!times) return 'no-date'
    const notes = `来自待办${task.notes ? `\n${task.notes}` : ''}`
    const candidateId = task.calendarEventId || pendingTaskLinks.get(operationKey)?.eventId
    let eventId = candidateId && cal.events.some((e) => e.id === candidateId) ? candidateId : ''
    const existing = Boolean(eventId)
    if (eventId) {
      cal.updateEvent(eventId, { title: task.title, ...times, notes })
    } else {
      const ev = cal.addEvent({
        calendarId: ensureTodoCalendarId(),
        title: task.title,
        ...times,
        notes,
        recurrence: null,
      })
      eventId = ev.id
      pendingTaskLinks.set(operationKey, { ownerKey, eventId })
    }
    await cal.flushPending()
    settingsPrincipalRuntime.assertCurrent(snapshot)
    useTasksStore.getState().updateTask(taskId, { calendarEventId: eventId })
    await useTasksStore.getState().flushPending()
    settingsPrincipalRuntime.assertCurrent(snapshot)
    pendingTaskLinks.delete(operationKey)
    return existing ? 'updated' : 'synced'
  })
}

// 一键: 把所有「未完成且有到期日」的任务同步到个人日历, 返回成功数量。
export async function syncAllTasksToCalendar(): Promise<number> {
  const snapshot = settingsPrincipalRuntime.snapshot()
  await useTasksStore.getState().init()
  settingsPrincipalRuntime.assertCurrent(snapshot)
  if (!useTasksStore.getState().loaded) throw new Error(useTasksStore.getState().loadError)
  const tasks = useTasksStore.getState().tasks.filter((t) => !t.completed && t.dueDate)
  let n = 0
  for (const t of tasks) {
    settingsPrincipalRuntime.assertCurrent(snapshot)
    const r = await syncTaskToCalendar(t.id)
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

export interface ShareToTeamInput {
  title: string
  start: string
  end: string
  allDay: boolean
  location?: string
  description?: string
  color?: string
}

// 跨面板共享复用组队日历的数据入口，成功保存后调用者才显示成功。
export function shareEventToTeam(input: ShareToTeamInput): Promise<TeamEvent> {
  return createTeamCalendarClient().createEvent({ ...input, attendees: [] })
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
