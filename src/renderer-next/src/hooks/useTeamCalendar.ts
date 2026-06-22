import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useChatStore } from '@/store/useChatStore'
import { wsBus } from '@/lib/wsBus'
import {
  selectSortedEvents,
  useTeamCalendarStore,
  type RsvpStatus,
  type TeamEvent,
} from '@/store/useTeamCalendarStore'

// 组队(共享)日历主控 hook。
// 职责:
//  1. 身份复用: 从 useChatStore.identity 读取 { serverUrl, token, username, displayName }。
//  2. 加载: 登录态下 REST 拉取房间事件; 否则降级本地 (localStorage)。
//  3. 实时: 复用聊天的 ws-url 约定, 自建一条只读 WS 监听 calendar_event_* 广播;
//     若服务端不支持(WS 不发该类型), ~15s 轮询兜底保证最终一致。
//  4. 写操作: createEvent / updateEvent / deleteEvent / setRsvp; 服务端模式走 REST,
//     本地模式直接改 store + 持久化。
//
// 与 useChat.ts 解耦: 不复用其 WebSocket 实例, 自建独立连接 (本 hook 自有), 不修改 useChat。

// 本地降级持久化 key。
const LOCAL_STORAGE_KEY = 'team-calendar:local-events'
const LOCAL_SUBNET = 'local'
const POLL_INTERVAL_MS = 15000

// ----- 本地降级存储 -----
function loadLocalEvents(): TeamEvent[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as TeamEvent[]) : []
  } catch {
    return []
  }
}

function saveLocalEvents(events: TeamEvent[]): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(events))
  } catch {
    /* 配额/隐私模式失败可忽略 */
  }
}

export interface TeamEventDraft {
  title: string
  description?: string
  location?: string
  start: string
  end: string
  allDay: boolean
  color?: string
  attendees: { username: string; displayName: string }[]
}

export interface UseTeamCalendar {
  source: 'loading' | 'server' | 'local'
  username: string
  displayName: string
  events: TeamEvent[]
  reload: () => Promise<void>
  createEvent: (draft: TeamEventDraft) => Promise<void>
  updateEvent: (id: string, patch: Partial<TeamEventDraft>) => Promise<void>
  deleteEvent: (id: string) => Promise<void>
  setRsvp: (id: string, status: RsvpStatus) => Promise<void>
}

export function useTeamCalendar(): UseTeamCalendar {
  const identity = useChatStore((s) => s.identity)
  const source = useTeamCalendarStore((s) => s.source)
  const eventsMap = useTeamCalendarStore((s) => s.events)
  const setSource = useTeamCalendarStore((s) => s.setSource)
  const replaceAll = useTeamCalendarStore((s) => s.replaceAll)
  const upsert = useTeamCalendarStore((s) => s.upsert)
  const remove = useTeamCalendarStore((s) => s.remove)

  const pollRef = useRef<number | null>(null)

  const loggedIn = Boolean(identity.serverUrl && identity.token)

  // 服务端模式下持久化镜像不需要; 本地模式下任何 events 变更都落 localStorage。
  useEffect(() => {
    if (source === 'local') saveLocalEvents(Object.values(eventsMap))
  }, [eventsMap, source])

  // 统一的 REST 请求封装: 失败抛错供上层 catch。
  const apiFetch = useCallback(async (path: string, init?: RequestInit): Promise<Response> => {
    const { serverUrl, token } = useChatStore.getState().identity
    return fetch(`${serverUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    })
  }, [])

  // 拉取房间事件; 404/其他错误 -> 降级本地。
  const reload = useCallback(async () => {
    if (!loggedIn) {
      replaceAll(loadLocalEvents())
      setSource('local')
      return
    }
    try {
      const res = await apiFetch('/api/team-calendar/events', { method: 'GET' })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const payload = (await res.json()) as { events?: TeamEvent[] }
      replaceAll(Array.isArray(payload.events) ? payload.events : [])
      setSource('server')
    } catch {
      // 服务端不支持该接口或网络错误: 降级本地预览。
      replaceAll(loadLocalEvents())
      setSource('local')
    }
  }, [apiFetch, loggedIn, replaceAll, setSource])

  // 首次 / 登录态变化时加载。
  useEffect(() => {
    void reload()
  }, [reload])

  // 实时: 服务端模式下复用协作聊天的唯一 WS (经 wsBus) 监听 calendar_event_*; 另加轮询兜底。
  // 不再自建 WS —— 同账号第二条连接会触发服务器「账号在别处登录」把聊天踢掉。
  useEffect(() => {
    if (source !== 'server') return
    let cancelled = false

    const unsub = wsBus.subscribe((payload) => {
      if (cancelled) return
      switch (String(payload.type || '')) {
        case 'calendar_event_created':
        case 'calendar_event_updated':
          if (payload.event) upsert(payload.event as TeamEvent)
          break
        case 'calendar_event_deleted':
          if (payload.id) remove(String(payload.id))
          break
        default:
          break
      }
    })

    // ~15s 轮询兜底 (WS 漏推/断连时最终一致)。
    pollRef.current = window.setInterval(() => {
      void reload()
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      if (pollRef.current) {
        window.clearInterval(pollRef.current)
        pollRef.current = null
      }
      unsub()
    }
  }, [source, reload, upsert, remove])

  // ----- 写操作 -----

  const createEvent = useCallback(
    async (draft: TeamEventDraft) => {
      const { username, displayName } = useChatStore.getState().identity
      if (useTeamCalendarStore.getState().source === 'server') {
        const res = await apiFetch('/api/team-calendar/events', {
          method: 'POST',
          body: JSON.stringify({
            ...draft,
            attendees: draft.attendees.map((a) => ({ ...a, rsvp: 'needs_action' })),
          }),
        })
        if (!res.ok) throw new Error(await res.text().catch(() => '创建事件失败'))
        const { event } = (await res.json()) as { event: TeamEvent }
        upsert(event)
        return
      }
      // 本地模式: 自行构造事件。
      const now = new Date().toISOString()
      const organizer = username || '我'
      const event: TeamEvent = {
        id: crypto.randomUUID(),
        subnetKey: LOCAL_SUBNET,
        title: draft.title,
        description: draft.description,
        location: draft.location,
        start: draft.start,
        end: draft.end,
        allDay: draft.allDay,
        organizer,
        attendees: draft.attendees.map((a) => ({ ...a, rsvp: 'needs_action' as RsvpStatus })),
        color: draft.color,
        createdBy: organizer,
        createdAt: now,
        updatedAt: now,
      }
      // 本地把组织者也加入 attendees, 以便本人能 RSVP。
      if (!event.attendees.some((a) => a.username === organizer)) {
        event.attendees.unshift({
          username: organizer,
          displayName: displayName || organizer,
          rsvp: 'accept',
        })
      }
      upsert(event)
    },
    [apiFetch, upsert],
  )

  const updateEvent = useCallback(
    async (id: string, patch: Partial<TeamEventDraft>) => {
      if (useTeamCalendarStore.getState().source === 'server') {
        const res = await apiFetch(`/api/team-calendar/events/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        })
        if (!res.ok) throw new Error(await res.text().catch(() => '编辑事件失败'))
        const { event } = (await res.json()) as { event: TeamEvent }
        upsert(event)
        return
      }
      const prev = useTeamCalendarStore.getState().events[id]
      if (!prev) return
      // 本地模式: patch.attendees 不含 rsvp, 需保留既有响应 (未知者默认 needs_action)。
      const { attendees: patchAttendees, ...rest } = patch
      const mergedAttendees = patchAttendees
        ? patchAttendees.map((a) => {
            const existing = prev.attendees.find((x) => x.username === a.username)
            return {
              username: a.username,
              displayName: a.displayName,
              rsvp: existing?.rsvp ?? ('needs_action' as RsvpStatus),
            }
          })
        : prev.attendees
      upsert({
        ...prev,
        ...rest,
        attendees: mergedAttendees,
        updatedAt: new Date().toISOString(),
      })
    },
    [apiFetch, upsert],
  )

  const deleteEvent = useCallback(
    async (id: string) => {
      if (useTeamCalendarStore.getState().source === 'server') {
        const res = await apiFetch(`/api/team-calendar/events/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        })
        if (!res.ok) throw new Error(await res.text().catch(() => '删除事件失败'))
        remove(id)
        return
      }
      remove(id)
    },
    [apiFetch, remove],
  )

  const setRsvp = useCallback(
    async (id: string, status: RsvpStatus) => {
      const { username, displayName } = useChatStore.getState().identity
      if (useTeamCalendarStore.getState().source === 'server') {
        const res = await apiFetch(`/api/team-calendar/events/${encodeURIComponent(id)}/rsvp`, {
          method: 'POST',
          body: JSON.stringify({ status }),
        })
        if (!res.ok) throw new Error(await res.text().catch(() => '更新 RSVP 失败'))
        const { event } = (await res.json()) as { event: TeamEvent }
        upsert(event)
        return
      }
      const prev = useTeamCalendarStore.getState().events[id]
      if (!prev) return
      const me = username || '我'
      const attendees = [...prev.attendees]
      const idx = attendees.findIndex((a) => a.username === me)
      if (idx >= 0) {
        attendees[idx] = { ...attendees[idx], rsvp: status }
      } else {
        attendees.push({ username: me, displayName: displayName || me, rsvp: status })
      }
      upsert({ ...prev, attendees, updatedAt: new Date().toISOString() })
    },
    [apiFetch, upsert],
  )

  const events = useMemo(() => selectSortedEvents(eventsMap), [eventsMap])

  return {
    source,
    username: identity.username,
    displayName: identity.displayName || identity.username,
    events,
    reload,
    createEvent,
    updateEvent,
    deleteEvent,
    setRsvp,
  }
}
