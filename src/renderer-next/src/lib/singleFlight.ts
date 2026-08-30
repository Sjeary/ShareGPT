export function createSingleFlight<T>() {
  let pending: Promise<T> | null = null
  return {
    run(operation: () => Promise<T>): Promise<T> {
      if (pending) return pending
      const started = Promise.resolve().then(operation)
      const tracked = started.finally(() => {
        if (pending === tracked) pending = null
      })
      pending = tracked
      return tracked
    },
  }
}
