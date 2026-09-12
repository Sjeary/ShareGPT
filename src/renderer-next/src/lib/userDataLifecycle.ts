import { useCalendarStore } from '@/store/useCalendarStore'
import { useTasksStore } from '@/store/useTasksStore'
import { useFocusStore } from '@/store/useFocusStore'
import { useVaultStore } from '@/store/useVaultStore'
import { chatPersistence } from './chatPersistence'
import { userDataTransitionState } from './userDataTransitionState'
import type { LegacyDataCategory } from '@/types/api'

let transitions: Promise<unknown> = Promise.resolve()

export async function reloadUserDataRuntime(
  categories: LegacyDataCategory[] = ['calendar', 'tasks', 'focus', 'notes', 'chat'],
) {
  const loaded = {
    calendar: useCalendarStore.getState().loaded,
    tasks: useTasksStore.getState().loaded,
    focus: useFocusStore.getState().loaded,
    vault: useVaultStore.getState().loaded,
    chat: chatPersistence.isLoaded(),
  }
  if (categories.includes('calendar')) useCalendarStore.getState().resetForPrincipal()
  if (categories.includes('tasks')) useTasksStore.getState().resetForPrincipal()
  if (categories.includes('focus')) useFocusStore.getState().resetForPrincipal()
  if (categories.includes('notes')) useVaultStore.getState().resetForPrincipal()
  if (categories.includes('chat')) chatPersistence.resetForPrincipal()
  await Promise.all([
    loaded.calendar && categories.includes('calendar')
      ? useCalendarStore.getState().init()
      : undefined,
    loaded.tasks && categories.includes('tasks') ? useTasksStore.getState().init() : undefined,
    loaded.focus && categories.includes('focus') ? useFocusStore.getState().init() : undefined,
    loaded.vault && categories.includes('notes') ? useVaultStore.getState().init() : undefined,
    loaded.chat && categories.includes('chat') ? chatPersistence.init() : undefined,
  ])
}

export function withUserDataTransition<T>(
  operation: () => Promise<T>,
  options: { reload?: boolean | LegacyDataCategory[] } = {},
): Promise<T> {
  const pending = transitions
    .catch(() => undefined)
    .then(async () => {
      userDataTransitionState.setSuspended(true)
      try {
        const flushed = await Promise.allSettled([
          useCalendarStore.getState().flushPending(),
          useTasksStore.getState().flushPending(),
          useFocusStore.getState().flushPending(),
          useVaultStore.getState().flushPending(),
          chatPersistence.flushPending(),
        ])
        const failed = flushed.find(
          (entry): entry is PromiseRejectedResult => entry.status === 'rejected',
        )
        if (failed) throw failed.reason
        const result = await operation()
        if (options.reload)
          await reloadUserDataRuntime(Array.isArray(options.reload) ? options.reload : undefined)
        return result
      } finally {
        userDataTransitionState.setSuspended(false)
      }
    })
  transitions = pending
  return pending
}
