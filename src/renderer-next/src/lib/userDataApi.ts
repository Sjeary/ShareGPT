import type { ShareGptApi } from '@/types/api'
import { settingsPrincipalRuntime } from './settingsPrincipalRuntime'

const stores = [
  'loadChatHistory',
  'saveChatHistory',
  'loadCalendar',
  'saveCalendar',
  'loadTasks',
  'saveTasks',
  'loadFocus',
  'saveFocus',
] as const

// Captured requests cannot mutate a later account in main or publish late results in renderer.
export function scopedUserDataApi(bridge: ShareGptApi): ShareGptApi {
  const wrap =
    (fn: (...args: unknown[]) => unknown) =>
    async (...args: unknown[]) => {
      const snapshot = settingsPrincipalRuntime.snapshot()
      const result = await fn(...args, snapshot)
      settingsPrincipalRuntime.assertCurrent(snapshot)
      return result
    }
  const result = { ...bridge } as ShareGptApi
  for (const name of stores) {
    const fn = bridge[name] as (...args: unknown[]) => unknown
    if (typeof fn === 'function') Object.assign(result, { [name]: wrap(fn) })
  }
  if (bridge.vault)
    result.vault = Object.fromEntries(
      Object.entries(bridge.vault).map(([key, fn]) => [
        key,
        key === 'create' ? (p: string, content = '') => wrap(fn)(p, content) : wrap(fn),
      ]),
    ) as unknown as ShareGptApi['vault']
  return result
}
