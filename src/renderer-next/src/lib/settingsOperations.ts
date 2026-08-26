import type { AdvancedAiSettings, AppSettings } from '../types/settings.ts'

export type SettingsOperation = { op: 'set' | 'delete'; path: string[]; value?: unknown }

export function principalSectionOperations(
  section: keyof AppSettings,
  currentValue: unknown,
  nextValue: unknown,
): SettingsOperation[] | null {
  if (section === 'translation') {
    const current = currentValue as Record<string, unknown>
    const next = nextValue as Record<string, unknown>
    const paths = [
      ['version'],
      ['provider'],
      ['sourceLanguage'],
      ['targetLanguage'],
      ['ai', 'baseUrl'],
      ['ai', 'apiKey'],
      ['ai', 'model'],
      ['ai', 'effort'],
      ['api', 'baseUrl'],
      ['api', 'apiKey'],
      ['offline', 'baseUrl'],
    ]
    const read = (value: Record<string, unknown>, path: string[]) =>
      path.reduce<unknown>(
        (parent, segment) =>
          parent && typeof parent === 'object'
            ? (parent as Record<string, unknown>)[segment]
            : undefined,
        value,
      )
    return paths.flatMap((path) => {
      const before = read(current, path)
      const after = read(next, path)
      return Object.is(before, after) ? [] : [{ op: 'set' as const, path, value: after }]
    })
  }
  if (section !== 'advancedAi') return null

  const current = currentValue as AdvancedAiSettings
  const next = nextValue as AdvancedAiSettings
  const operations: SettingsOperation[] = []
  if (current.enabled !== next.enabled)
    operations.push({ op: 'set', path: ['enabled'], value: next.enabled })
  for (const kind of ['gpt', 'gemini', 'claude'] as const) {
    if (current.activeByKind?.[kind] !== next.activeByKind?.[kind]) {
      operations.push({
        op: 'set',
        path: ['activeByKind', kind],
        value: next.activeByKind?.[kind] || '',
      })
    }
  }
  const currentById = new Map(
    current.environments.map((environment) => [environment.id, environment]),
  )
  const nextById = new Map(next.environments.map((environment) => [environment.id, environment]))
  for (const [id, environment] of nextById) {
    const before = currentById.get(id)
    if (!before) {
      operations.push({ op: 'set', path: ['environments', id], value: environment })
      continue
    }
    for (const field of ['name', 'routeId'] as const) {
      if (before[field] !== environment[field]) {
        operations.push({ op: 'set', path: ['environments', id, field], value: environment[field] })
      }
    }
  }
  for (const id of currentById.keys()) {
    if (!nextById.has(id)) operations.push({ op: 'delete', path: ['environments', id] })
  }
  return operations
}
