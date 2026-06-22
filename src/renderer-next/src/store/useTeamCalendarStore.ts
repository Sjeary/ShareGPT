import { create } from 'zustand'

// 组队(共享)日历 store 切片 (本面板自有, 不污染 useAppStore/useChatStore)。
// 数据来源:
//  - 协作服务器 REST: {server}/api/team-calendar/events  (鉴权复用聊天 token)
//  - 实时: 协作 WebSocket (wss?://host/ws?token=...) 的 calendar_event_* 消息;
//    若服务端不支持则降级到 ~15s 轮询。
//  - 未登录 / 服务端无该接口(404/error): 降级为本地团队日历, 持久化到 localStorage。
// 事件按房间(subnetKey)隔离, 由服务端盖章; 本地模式下全部归到本地房间。

// RSVP 状态 (对齐飞书): 接受 / 拒绝 / 待定 / 未响应。
export type RsvpStatus = 'needs_action' | 'accept' | 'decline' | 'tentative'

export interface TeamEventAttendee {
  username: string
  displayName: string
  rsvp: RsvpStatus
}

export interface TeamEvent {
  id: string
  subnetKey: string
  title: string
  description?: string
  location?: string
  start: string // ISO
  end: string // ISO
  allDay: boolean
  organizer: string // username
  attendees: TeamEventAttendee[]
  color?: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

// 连接 / 数据来源状态。
export type CalendarSource =
  | 'loading' // 首次加载中
  | 'server' // 已连接协作服务器, 走远端
  | 'local' // 降级本地预览 (未登录 / 服务端无接口)

// 月 / 周视图。
export type CalendarView = 'month' | 'week'

interface TeamCalendarState {
  events: Record<string, TeamEvent> // id -> event
  source: CalendarSource
  view: CalendarView
  // 锚点日期(当前视图所在的某一天), ISO 字符串。
  anchor: string
  // 成员筛选: 被取消勾选(隐藏)的 organizer 用户名集合。空 = 全部显示。
  hiddenOrganizers: string[]
  // 当前打开的编辑器目标 (null=关闭, 'new'=新建, 否则为事件 id)。
  editorTarget: string | null

  setSource: (source: CalendarSource) => void
  setView: (view: CalendarView) => void
  setAnchor: (anchor: string) => void
  openEditor: (target: string | null) => void
  toggleOrganizer: (username: string) => void

  // 全量替换 (REST 拉取后)。
  replaceAll: (events: TeamEvent[]) => void
  // 单条插入/更新 (REST 返回或 WS 广播)。
  upsert: (event: TeamEvent) => void
  // 删除。
  remove: (id: string) => void

  reset: () => void
}

export const useTeamCalendarStore = create<TeamCalendarState>((set) => ({
  events: {},
  source: 'loading',
  view: 'month',
  anchor: new Date().toISOString(),
  hiddenOrganizers: [],
  editorTarget: null,

  setSource: (source) => set({ source }),
  setView: (view) => set({ view }),
  setAnchor: (anchor) => set({ anchor }),
  openEditor: (editorTarget) => set({ editorTarget }),
  toggleOrganizer: (username) =>
    set((s) => ({
      hiddenOrganizers: s.hiddenOrganizers.includes(username)
        ? s.hiddenOrganizers.filter((u) => u !== username)
        : [...s.hiddenOrganizers, username],
    })),

  replaceAll: (events) =>
    set(() => {
      const map: Record<string, TeamEvent> = {}
      for (const e of events) map[e.id] = e
      return { events: map }
    }),
  upsert: (event) => set((s) => ({ events: { ...s.events, [event.id]: event } })),
  remove: (id) =>
    set((s) => {
      if (!(id in s.events)) return s
      const next = { ...s.events }
      delete next[id]
      return { events: next }
    }),

  reset: () =>
    set({
      events: {},
      source: 'loading',
      view: 'month',
      anchor: new Date().toISOString(),
      hiddenOrganizers: [],
      editorTarget: null,
    }),
}))

// 选择器: 排序后的事件列表 (按开始时间)。
export function selectSortedEvents(events: Record<string, TeamEvent>): TeamEvent[] {
  return Object.values(events).sort((a, b) => a.start.localeCompare(b.start))
}

// 按 organizer 生成稳定颜色 (成员色), 用于月/周视图区分不同人的事件。
const MEMBER_PALETTE = [
  '#2563eb', // blue
  '#16a34a', // green
  '#db2777', // pink
  '#ea580c', // orange
  '#7c3aed', // violet
  '#0891b2', // cyan
  '#ca8a04', // amber
  '#dc2626', // red
]

export function colorForOrganizer(username: string): string {
  let hash = 0
  for (let i = 0; i < username.length; i += 1) {
    hash = (hash * 31 + username.charCodeAt(i)) >>> 0
  }
  return MEMBER_PALETTE[hash % MEMBER_PALETTE.length]
}
