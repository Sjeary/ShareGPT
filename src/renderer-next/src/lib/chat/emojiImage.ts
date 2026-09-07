// Keep successful image loads only: an offline request is not a missing combination.
export function createEmojiImageLoader(load: (url: string) => Promise<void>, limit = 128) {
  const ready = new Map<string, true>()
  const pending = new Map<string, Promise<void>>()
  return (url: string): Promise<void> => {
    if (ready.has(url)) {
      ready.delete(url)
      ready.set(url, true)
      return Promise.resolve()
    }
    const existing = pending.get(url)
    if (existing) return existing
    const request = Promise.resolve()
      .then(() => load(url))
      .then(() => {
        ready.set(url, true)
        while (ready.size > Math.max(0, limit)) ready.delete(ready.keys().next().value!)
      })
      .finally(() => pending.delete(url))
    pending.set(url, request)
    return request
  }
}

export const loadEmojiImage = createEmojiImageLoader(
  (url) =>
    new Promise<void>((resolve, reject) => {
      const image = new Image()
      const finish = (error?: Error) => {
        clearTimeout(timeout)
        image.onload = image.onerror = null
        if (error) {
          image.src = ''
          reject(error)
        } else resolve()
      }
      const timeout = setTimeout(() => finish(new Error('Emoji image timed out')), 15000)
      image.onload = () => finish()
      image.onerror = () => finish(new Error('Emoji image unavailable'))
      image.src = url
    }),
)
