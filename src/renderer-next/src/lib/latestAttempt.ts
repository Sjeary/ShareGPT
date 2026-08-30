export class StaleAttemptError extends Error {
  constructor() {
    super('新的操作已开始，旧操作已取消')
    this.name = 'StaleAttemptError'
  }
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
