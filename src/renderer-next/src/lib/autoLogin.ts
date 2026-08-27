import type { CollabSettings } from '@/types/settings'

export interface AutoLoginParams {
  serverUrl: string
  username: string
  password: string
  rememberPassword: true
}

export function autoLoginParams(
  collab: Partial<CollabSettings> | null | undefined,
): AutoLoginParams | null {
  if (!collab || collab.auto_login === false || collab.remember_password !== true) return null
  const serverUrl = String(collab.server_url || '').trim()
  const username = String(collab.last_username || '').trim()
  const password = String(collab.saved_password || '')
  if (!serverUrl || !username || !password) return null
  return { serverUrl, username, password, rememberPassword: true }
}
