export async function coalesceInFlight<T>(
  requests: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const existing = requests.get(key)
  if (existing) return existing

  const pending = Promise.resolve().then(load)
  requests.set(key, pending)
  try {
    return await pending
  } finally {
    if (requests.get(key) === pending) requests.delete(key)
  }
}
