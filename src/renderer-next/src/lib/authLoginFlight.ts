let inFlight: Promise<unknown> | null = null

export function runAuthLoginSingleFlight<T>(operation: () => Promise<T>): Promise<T> {
  if (inFlight) return inFlight as Promise<T>
  const attempt = operation()
  inFlight = attempt
  void attempt.then(
    () => {
      if (inFlight === attempt) inFlight = null
    },
    () => {
      if (inFlight === attempt) inFlight = null
    },
  )
  return attempt
}
