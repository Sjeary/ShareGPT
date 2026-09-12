import { useSyncExternalStore } from 'react'

let suspended = false
const listeners = new Set<() => void>()

export const userDataTransitionState = {
  isSuspended: () => suspended,
  setSuspended(value: boolean) {
    suspended = value
    for (const listener of listeners) listener()
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

export function assertUserDataWritable() {
  if (suspended) throw new Error('正在切换资料，请稍候')
}

export function useUserDataTransition() {
  return useSyncExternalStore(
    userDataTransitionState.subscribe,
    userDataTransitionState.isSuspended,
  )
}
