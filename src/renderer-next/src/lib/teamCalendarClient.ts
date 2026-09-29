import { useChatStore, type ChatIdentity } from '@/store/useChatStore'
import { useTeamCalendarStore, type TeamEvent, type RsvpStatus } from '@/store/useTeamCalendarStore'
import {
  settingsPrincipalRuntime,
  StaleSettingsPrincipalError,
  type SettingsPrincipalSnapshot,
} from './settingsPrincipalRuntime'
import { userDataTransitionState } from './userDataTransitionState'

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

export function teamCalendarCacheKey(principalId: string): string {
  return `team-calendar:principal:${encodeURIComponent(principalId)}`
}

function loadCache(principalId: string): TeamEvent[] {
  const raw = localStorage.getItem(teamCalendarCacheKey(principalId))
  if (!raw) return []
  const events: unknown = JSON.parse(raw)
  if (
    !Array.isArray(events) ||
    events.some(
      (event) => !event || typeof event.id !== 'string' || typeof event.start !== 'string',
    )
  )
    throw new Error('组队日历本机缓存无法读取，原有资料已保留。')
  return events as TeamEvent[]
}

// 每个调用者绑定启动时的账号和代次；hook 与跨面板共享走同一个数据入口。
export function createTeamCalendarClient(
  identity: ChatIdentity = useChatStore.getState().identity,
  principal: SettingsPrincipalSnapshot = settingsPrincipalRuntime.current(),
  transitionRevision = userDataTransitionState.revision(),
) {
  const captured = { ...identity }
  const loggedIn = Boolean(captured.serverUrl && captured.token)
  let reloadSequence = 0
  const isCurrent = () => {
    const current = settingsPrincipalRuntime.current()
    const latest = useChatStore.getState().identity
    return (
      Boolean(principal.principalId) &&
      current.principalId === principal.principalId &&
      current.generation === principal.generation &&
      latest.serverUrl === captured.serverUrl &&
      latest.username === captured.username &&
      latest.token === captured.token &&
      !userDataTransitionState.isSuspended() &&
      userDataTransitionState.revision() === transitionRevision
    )
  }
  const assertCurrent = () => {
    if (!isCurrent()) throw new StaleSettingsPrincipalError()
  }
  const prepare = () => {
    assertCurrent()
    const store = useTeamCalendarStore.getState()
    if (
      store.owner?.principalId !== principal.principalId ||
      store.owner.generation !== principal.generation
    ) {
      store.reset()
      useTeamCalendarStore.setState({ owner: principal })
    }
  }
  const save = (events: TeamEvent[], source: 'local' | 'server') => {
    assertCurrent()
    // 本地写失败必须保留现有快照；远端已提交的内容仍显示，并明确提示缓存错误。
    let loadError = ''
    try {
      localStorage.setItem(teamCalendarCacheKey(principal.principalId), JSON.stringify(events))
    } catch (error) {
      if (source === 'local') throw error
      loadError = '组队日历已同步，但本机缓存保存失败。请检查可用空间后重试。'
    }
    useTeamCalendarStore.getState().replaceAll(events)
    useTeamCalendarStore.setState({ source, loading: false, loadError })
  }
  const owned = async <T>(operation: Promise<T>): Promise<T> => {
    try {
      const value = await operation
      assertCurrent()
      return value
    } catch (error) {
      assertCurrent()
      throw error
    }
  }
  const request = async (path: string, init?: RequestInit): Promise<Response> => {
    assertCurrent()
    const response = await owned(
      fetch(`${captured.serverUrl}/api/team-calendar/events${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${captured.token}` },
      }),
    )
    assertCurrent()
    if (!response.ok) {
      const detail = await owned(response.text().catch(() => ''))
      assertCurrent()
      throw new Error(`组队日历请求失败 (${response.status})${detail ? `：${detail}` : ''}`)
    }
    return response
  }
  const remoteEvent = async (path: string, init: RequestInit) => {
    prepare()
    if (useTeamCalendarStore.getState().source === 'loading') {
      useTeamCalendarStore.getState().replaceAll(loadCache(principal.principalId))
    }
    const response = await request(path, init)
    const { event } = (await owned(response.json())) as { event: TeamEvent }
    assertCurrent()
    if (!event?.id) throw new Error('组队日历返回了无效事件')
    save(Object.values({ ...useTeamCalendarStore.getState().events, [event.id]: event }), 'server')
    return event
  }
  const localEvents = () => {
    prepare()
    return loadCache(principal.principalId)
  }

  return {
    isCurrent,
    async reload() {
      if (!isCurrent()) return
      prepare()
      const sequence = ++reloadSequence
      const current = () => isCurrent() && sequence === reloadSequence
      useTeamCalendarStore.setState({ loading: true, loadError: '' })
      try {
        if (!loggedIn) {
          const events = loadCache(principal.principalId)
          if (current()) {
            useTeamCalendarStore.getState().replaceAll(events)
            useTeamCalendarStore.setState({ source: 'local', loading: false })
          }
          return
        }
        // 仅恢复这个 Principal 的镜像，绝不读取未归属的旧全局缓存。
        if (useTeamCalendarStore.getState().source === 'loading') {
          try {
            useTeamCalendarStore.getState().replaceAll(loadCache(principal.principalId))
          } catch {
            /* 远端成功可修复镜像，失败时下方保留原文件并提示。 */
          }
        }
        const response = await request('', { method: 'GET' })
        const payload = (await owned(response.json())) as { events?: TeamEvent[] }
        if (!current()) return
        if (!Array.isArray(payload.events)) throw new Error('组队日历返回了无效列表')
        save(payload.events, 'server')
      } catch (error) {
        if (current())
          useTeamCalendarStore.setState({
            loading: false,
            loadError: error instanceof Error ? error.message : '组队日历加载失败，请重试。',
          })
      }
    },
    async createEvent(draft: TeamEventDraft): Promise<TeamEvent> {
      prepare()
      if (loggedIn)
        return remoteEvent('', {
          method: 'POST',
          body: JSON.stringify({
            ...draft,
            attendees: draft.attendees.map((a) => ({ ...a, rsvp: 'needs_action' })),
          }),
        })
      const events = localEvents()
      const organizer = captured.username || '我'
      const now = new Date().toISOString()
      const attendees = draft.attendees.map((a) => ({ ...a, rsvp: 'needs_action' as RsvpStatus }))
      if (!attendees.some((a) => a.username === organizer))
        attendees.unshift({
          username: organizer,
          displayName: captured.displayName || organizer,
          rsvp: 'accept',
        })
      const event: TeamEvent = {
        ...draft,
        id: crypto.randomUUID(),
        subnetKey: 'local',
        organizer,
        attendees,
        createdBy: organizer,
        createdAt: now,
        updatedAt: now,
      }
      save([...events, event], 'local')
      return event
    },
    async updateEvent(id: string, patch: Partial<TeamEventDraft>): Promise<void> {
      prepare()
      if (loggedIn) {
        await remoteEvent(`/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        })
        return
      }
      const events = localEvents()
      const previous = events.find((event) => event.id === id)
      if (!previous) return
      const { attendees, ...rest } = patch
      const event = {
        ...previous,
        ...rest,
        attendees:
          attendees?.map((a) => ({
            ...a,
            rsvp:
              previous.attendees.find((old) => old.username === a.username)?.rsvp ??
              ('needs_action' as RsvpStatus),
          })) ?? previous.attendees,
        updatedAt: new Date().toISOString(),
      }
      save(
        events.map((old) => (old.id === id ? event : old)),
        'local',
      )
    },
    async deleteEvent(id: string): Promise<void> {
      prepare()
      if (loggedIn) {
        await request(`/${encodeURIComponent(id)}`, { method: 'DELETE' })
        assertCurrent()
        save(
          Object.values(useTeamCalendarStore.getState().events).filter((event) => event.id !== id),
          'server',
        )
      } else
        save(
          localEvents().filter((event) => event.id !== id),
          'local',
        )
    },
    async setRsvp(id: string, status: RsvpStatus): Promise<void> {
      prepare()
      if (loggedIn) {
        await remoteEvent(`/${encodeURIComponent(id)}/rsvp`, {
          method: 'POST',
          body: JSON.stringify({ status }),
        })
        return
      }
      const events = localEvents()
      const previous = events.find((event) => event.id === id)
      if (!previous) return
      const username = captured.username || '我'
      const attendees = previous.attendees.filter((a) => a.username !== username)
      attendees.push({ username, displayName: captured.displayName || username, rsvp: status })
      save(
        events.map((event) =>
          event.id === id ? { ...event, attendees, updatedAt: new Date().toISOString() } : event,
        ),
        'local',
      )
    },
    receive(payload: Record<string, unknown>) {
      if (!isCurrent() || !loggedIn) return
      prepare()
      const events = useTeamCalendarStore.getState().events
      if (
        (payload.type === 'calendar_event_created' || payload.type === 'calendar_event_updated') &&
        payload.event
      ) {
        const event = payload.event as TeamEvent
        if (event.id) save(Object.values({ ...events, [event.id]: event }), 'server')
      } else if (payload.type === 'calendar_event_deleted' && payload.id) {
        save(
          Object.values(events).filter((event) => event.id !== String(payload.id)),
          'server',
        )
      }
    },
  }
}
