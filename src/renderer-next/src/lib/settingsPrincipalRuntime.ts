export interface SettingsPrincipalSnapshot {
  principalId: string
  generation: number
}

export interface SettingsPrincipalRuntime {
  activate: (principalId: string, generation?: number) => SettingsPrincipalSnapshot
  invalidate: () => SettingsPrincipalSnapshot
  current: () => SettingsPrincipalSnapshot
  snapshot: () => SettingsPrincipalSnapshot
  assertCurrent: (expected: SettingsPrincipalSnapshot) => void
}

export class StaleSettingsPrincipalError extends Error {
  constructor() {
    super('设置账号已切换，旧操作已取消')
    this.name = 'StaleSettingsPrincipalError'
  }
}

export function createSettingsPrincipalRuntime(
  initialPrincipalId = 'local-device',
): SettingsPrincipalRuntime {
  let principalId = String(initialPrincipalId || '')
  let generation = 0

  const current = () => ({ principalId, generation })
  const assertCurrent = (expected: SettingsPrincipalSnapshot) => {
    if (
      !expected.principalId ||
      expected.principalId !== principalId ||
      expected.generation !== generation
    ) {
      throw new StaleSettingsPrincipalError()
    }
  }

  return {
    activate(nextPrincipalId, nextGeneration) {
      principalId = String(nextPrincipalId || '')
      generation = Number.isInteger(nextGeneration) ? Number(nextGeneration) : generation + 1
      return current()
    },
    invalidate() {
      principalId = ''
      generation += 1
      return current()
    },
    current,
    snapshot() {
      const value = current()
      if (!value.principalId) throw new StaleSettingsPrincipalError()
      return value
    },
    assertCurrent,
  }
}

export const settingsPrincipalRuntime = createSettingsPrincipalRuntime()

interface ApplyPrincipalOperationOptions<T> {
  runtime?: SettingsPrincipalRuntime
  snapshot: SettingsPrincipalSnapshot
  operation: (expectedPrincipalId: string) => Promise<T>
  apply: (value: T) => void
}

export async function applyPrincipalOperation<T>({
  runtime = settingsPrincipalRuntime,
  snapshot,
  operation,
  apply,
}: ApplyPrincipalOperationOptions<T>): Promise<T> {
  runtime.assertCurrent(snapshot)
  const value = await operation(snapshot.principalId)
  runtime.assertCurrent(snapshot)
  apply(value)
  return value
}

interface RevisionedSettings {
  settingsRevision?: number
}

interface PersistPrincipalSettingsOptions<T extends RevisionedSettings> {
  runtime?: SettingsPrincipalRuntime
  snapshot: SettingsPrincipalSnapshot
  current: T
  write: (expectedRevision: number | undefined, expectedPrincipalId: string) => Promise<T>
  loadLatest: (expectedPrincipalId: string) => Promise<T>
  apply: (settings: T) => void
  isRevisionConflict: (error: unknown) => boolean
}

export async function persistPrincipalSettings<T extends RevisionedSettings>({
  runtime = settingsPrincipalRuntime,
  snapshot,
  current,
  write,
  loadLatest,
  apply,
  isRevisionConflict,
}: PersistPrincipalSettingsOptions<T>): Promise<T> {
  const persist = async (expectedRevision: number | undefined) => {
    runtime.assertCurrent(snapshot)
    const saved = await write(expectedRevision, snapshot.principalId)
    runtime.assertCurrent(snapshot)
    apply(saved)
    return saved
  }

  try {
    return await persist(current.settingsRevision)
  } catch (error) {
    runtime.assertCurrent(snapshot)
    let latest = current
    try {
      latest = await loadLatest(snapshot.principalId)
    } catch {
      // Retain the caller's snapshot when the local settings reload itself fails.
    }
    runtime.assertCurrent(snapshot)
    if (isRevisionConflict(error)) return persist(latest.settingsRevision)
    apply(latest)
    throw error
  }
}
