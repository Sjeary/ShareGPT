import { useCalendarStore } from '@/store/useCalendarStore'
import { useTasksStore } from '@/store/useTasksStore'
import { useFocusStore } from '@/store/useFocusStore'
import { useVaultStore } from '@/store/useVaultStore'
import { chatPersistence } from './chatPersistence'
import { userDataTransitionState } from './userDataTransitionState'

let transitions: Promise<unknown> = Promise.resolve()

export async function reloadUserDataRuntime() {
  const loaded = {
    calendar: useCalendarStore.getState().loaded,
    tasks: useTasksStore.getState().loaded,
    focus: useFocusStore.getState().loaded,
    vault: useVaultStore.getState().loaded,
    chat: chatPersistence.isLoaded(),
  }
  useCalendarStore.getState().resetForPrincipal()
  useTasksStore.getState().resetForPrincipal()
  useFocusStore.getState().resetForPrincipal()
  useVaultStore.getState().resetForPrincipal()
  chatPersistence.resetForPrincipal()
  await Promise.all([
    loaded.calendar ? useCalendarStore.getState().init() : undefined,
    loaded.tasks ? useTasksStore.getState().init() : undefined,
    loaded.focus ? useFocusStore.getState().init() : undefined,
    loaded.vault ? useVaultStore.getState().init() : undefined,
    loaded.chat ? chatPersistence.init() : undefined,
  ])
}

export function withUserDataTransition<T>(
  operation: () => Promise<T>,
  options: { reload?: boolean } = {},
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
        if (options.reload) await reloadUserDataRuntime()
        return result
      } finally {
        userDataTransitionState.setSuspended(false)
      }
    })
  transitions = pending
  return pending
}
