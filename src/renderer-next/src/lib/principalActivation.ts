import { requireSettingsPrincipalSnapshot } from '@/lib/settingsPrincipalRuntime'

export interface PrincipalActivation {
  principalId: string
  generation: number
  settings: Record<string, unknown>
}

export function requirePrincipalActivation(value: unknown): PrincipalActivation {
  const snapshot = requireSettingsPrincipalSnapshot(value)
  const settings = (value as Partial<PrincipalActivation> | null)?.settings
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('主进程未返回完整的 Principal 设置快照')
  }
  return { ...snapshot, settings }
}
