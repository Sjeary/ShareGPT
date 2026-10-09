import { useEffect, useMemo } from 'react'
import { useChatStore } from '@/store/useChatStore'
import { wsBus } from '@/lib/wsBus'
import { settingsPrincipalRuntime } from '@/lib/settingsPrincipalRuntime'
import { useUserDataTransitionVersion } from '@/lib/userDataTransitionState'
import { createTeamCalendarClient, type TeamEventDraft } from '@/lib/teamCalendarClient'
import {
  selectSortedEvents,
  useTeamCalendarStore,
  type RsvpStatus,
  type TeamEvent,
} from '@/store/useTeamCalendarStore'

export type { TeamEventDraft } from '@/lib/teamCalendarClient'

export interface UseTeamCalendar {
  source: 'loading' | 'server' | 'local'
  ownsSnapshot: boolean
  loading: boolean
  loadError: string
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
  const transitionVersion = useUserDataTransitionVersion()
  const owner = useTeamCalendarStore((s) => s.owner)
  const source = useTeamCalendarStore((s) => s.source)
  const loading = useTeamCalendarStore((s) => s.loading)
  const loadError = useTeamCalendarStore((s) => s.loadError)
  const eventsMap = useTeamCalendarStore((s) => s.events)
  const { principalId, generation } = settingsPrincipalRuntime.current()
  const ownsSnapshot =
    owner?.principalId === principalId &&
    owner?.generation === generation &&
    transitionVersion % 2 === 0
  const client = useMemo(
    () =>
      createTeamCalendarClient(
        identity,
        { principalId, generation },
        Math.floor(transitionVersion / 2),
      ),
    [identity, principalId, generation, transitionVersion],
  )

  useEffect(() => {
    void client.reload()
    if (!identity.serverUrl || !identity.token) return
    const unsubscribe = wsBus.subscribe(client.receive)
    const poll = window.setInterval(() => void client.reload(), 15000)
    return () => {
      unsubscribe()
      window.clearInterval(poll)
    }
  }, [client, identity.serverUrl, identity.token])

  const events = useMemo(
    () => (ownsSnapshot ? selectSortedEvents(eventsMap) : []),
    [eventsMap, ownsSnapshot],
  )
  return {
    ownsSnapshot,
    source: ownsSnapshot ? source : 'loading',
    loading: !ownsSnapshot || loading,
    loadError: ownsSnapshot ? loadError : '',
    username: identity.username,
    displayName: identity.displayName || identity.username,
    events,
    reload: client.reload,
    createEvent: async (draft) => {
      await client.createEvent(draft)
    },
    updateEvent: client.updateEvent,
    deleteEvent: client.deleteEvent,
    setRsvp: client.setRsvp,
  }
}
