import { useSyncExternalStore } from 'react'

let suspended = false
let revision = 0
const listeners = new Set<() => void>()

export const userDataTransitionState = {
  isSuspended: () => suspended,
  revision: () => revision,
  setSuspended(value: boolean) {
    if (value && !suspended) revision += 1
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

export function useUserDataTransitionVersion() {
  return useSyncExternalStore(
    userDataTransitionState.subscribe,
    () => revision * 2 + Number(suspended),
  )
}
