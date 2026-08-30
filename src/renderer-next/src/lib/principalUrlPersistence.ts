export interface PrincipalUrlSnapshot {
  principalId: string
  generation: number
}

export interface PrincipalUrlRuntime {
  snapshot: () => PrincipalUrlSnapshot
  assertCurrent: (snapshot: PrincipalUrlSnapshot) => void
}

interface PrincipalUrlPersistenceOptions {
  delayMs: number
  runtime: PrincipalUrlRuntime
  patch: (section: string, lastUrl: string) => Promise<unknown>
}

export function createPrincipalUrlPersistence({
  delayMs,
  runtime,
  patch,
}: PrincipalUrlPersistenceOptions) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const lastPersisted = new Map<string, string>()
  const pending = new Map<string, object>()
  const inFlight = new Map<string, object>()

  const persist = (section: string, lastUrl: string) => {
    const next = String(lastUrl || '').trim()
    if (!next) return
    const principal = runtime.snapshot()
    const key = `${principal.principalId}:${section}`
    if (lastPersisted.get(key) === next) return

    const operation = { next, principal }
    const currentPending = pending.get(key) as typeof operation | undefined
    if (
      currentPending?.next === next &&
      currentPending.principal.generation === principal.generation
    )
      return

    const previous = timers.get(key)
    if (previous) clearTimeout(previous)
    pending.set(key, operation)
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key)
        if (pending.get(key) !== operation) return
        pending.delete(key)
        try {
          runtime.assertCurrent(principal)
        } catch {
          return
        }
        inFlight.set(key, operation)
        void patch(section, next)
          .then(() => {
            if (inFlight.get(key) !== operation) return
            try {
              runtime.assertCurrent(principal)
            } catch {
              return
            }
            lastPersisted.set(key, next)
          })
          .catch(() => {})
          .finally(() => {
            if (inFlight.get(key) === operation) inFlight.delete(key)
          })
      }, delayMs),
    )
  }

  const dispose = () => {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    pending.clear()
    inFlight.clear()
    lastPersisted.clear()
  }

  return { dispose, persist }
}
