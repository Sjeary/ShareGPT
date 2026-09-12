import {
  settingsPrincipalRuntime,
  StaleSettingsPrincipalError,
  type SettingsPrincipalSnapshot,
} from './settingsPrincipalRuntime'

export function createPrincipalDebouncedSave<T>(
  save: (payload: T, snapshot: SettingsPrincipalSnapshot) => Promise<unknown>,
) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: { payload: T; snapshot: SettingsPrincipalSnapshot } | null = null
  let tail: Promise<void> = Promise.resolve()

  const flushPending = (): Promise<void> => {
    if (timer) clearTimeout(timer)
    timer = null
    const operation = pending
    pending = null
    if (operation) {
      tail = tail
        .catch(() => undefined)
        .then(async () => {
          try {
            settingsPrincipalRuntime.assertCurrent(operation.snapshot)
            await save(operation.payload, operation.snapshot)
            settingsPrincipalRuntime.assertCurrent(operation.snapshot)
          } catch (error) {
            const current = settingsPrincipalRuntime.current()
            if (
              current.principalId !== operation.snapshot.principalId ||
              current.generation !== operation.snapshot.generation
            )
              return
            if (error instanceof StaleSettingsPrincipalError) return
            if (!pending) pending = operation
            throw error
          }
        })
    }
    return tail
  }

  return {
    schedule(payload: T, snapshot: SettingsPrincipalSnapshot) {
      settingsPrincipalRuntime.assertCurrent(snapshot)
      pending = { payload: structuredClone(payload), snapshot }
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void flushPending().catch(() => console.error('个人数据保存失败，请重试'))
      }, 300)
    },
    flushPending,
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      pending = null
    },
  }
}
