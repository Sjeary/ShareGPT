export class StaleAttemptError extends Error {
  constructor() {
    super('新的操作已开始，旧操作已取消')
    this.name = 'StaleAttemptError'
  }
}

// Stale attempts are expected control flow: a newer login or workspace choice owns the result.
// They must never be presented to the user as an authentication failure.
export function isStaleAttemptError(error: unknown): error is StaleAttemptError {
  return (
    error instanceof StaleAttemptError ||
    (error instanceof Error && error.name === 'StaleAttemptError')
  )
}

export function createLatestAttemptCoordinator() {
  let latestAttempt = 0
  return {
    begin() {
      latestAttempt += 1
      return latestAttempt
    },
    invalidate() {
      latestAttempt += 1
    },
    isCurrent(attempt: number) {
      return attempt === latestAttempt
    },
    assertCurrent(attempt: number) {
      if (attempt !== latestAttempt) throw new StaleAttemptError()
    },
  }
}
