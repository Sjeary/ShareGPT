export type StoreDeletions = Record<string, Record<string, string>>

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

export function mergeDeletions(...sources: unknown[]): StoreDeletions {
  const collections = new Map<string, Map<string, string>>()
  for (const source of sources) {
    for (const [collection, ids] of Object.entries(record(source))) {
      if (!['calendars', 'events', 'lists', 'tasks', 'memos'].includes(collection)) continue
      const merged = collections.get(collection) ?? new Map<string, string>()
      for (const [id, value] of Object.entries(record(ids))) {
        if (!id || typeof value !== 'string' || !Number.isFinite(Date.parse(value))) continue
        const previous = merged.get(id)
        if (!previous || Date.parse(value) > Date.parse(previous)) {
          merged.set(id, new Date(value).toISOString())
        }
      }
      if (merged.size) collections.set(collection, merged)
    }
  }
  return Object.fromEntries(
    [...collections].map(([collection, ids]) => [collection, Object.fromEntries(ids)]),
  )
}

export function markDeleted(
  previous: StoreDeletions,
  collection: string,
  ids: string[],
): StoreDeletions {
  const timestamp = new Date().toISOString()
  return mergeDeletions(previous, {
    [collection]: Object.fromEntries(ids.map((id) => [id, timestamp])),
  })
}

export function isDeleted(deleted: StoreDeletions, collection: string, id: string): boolean {
  return Object.hasOwn(deleted[collection] ?? {}, id)
}

export function filterDeleted<T extends { id: string }>(
  items: T[],
  deleted: StoreDeletions,
  collection: string,
): T[] {
  return items.filter((item) => !isDeleted(deleted, collection, item.id))
}
