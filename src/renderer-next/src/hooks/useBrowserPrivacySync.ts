import { useEffect } from 'react'
import { saveBrowserPrivacySettings } from '@/lib/browserPrivacyRuntime'
import { useAppStore } from '@/store/useAppStore'
import { useChatStore } from '@/store/useChatStore'
import { createAccountSync } from '@/lib/accountSync'
import { useUserDataTransitionVersion } from '@/lib/userDataTransitionState'
import {
  browserPrivacySyncPayload,
  isSyncedBrowserPrivacy,
  mergeBrowserPrivacySync,
  type SyncedBrowserPrivacy,
} from '@/lib/browserPrivacySyncPolicy'

function revKey(serverUrl: string, username: string): string {
  return `browser-privacy:rev:${serverUrl}:${username}`
}

function loadRev(serverUrl: string, username: string): number {
  try {
    const value = Number(localStorage.getItem(revKey(serverUrl, username)))
    return Number.isInteger(value) && value >= 0 ? value : 0
  } catch {
    return 0
  }
}

function saveRev(serverUrl: string, username: string, rev: number): void {
  try {
    localStorage.setItem(revKey(serverUrl, username), String(rev))
  } catch {
    /* 本地 rev 丢失只会导致下次重新比对，不影响配置正确性。 */
  }
}

export function useBrowserPrivacySync(): void {
  const dataVersion = useUserDataTransitionVersion()
  const serverUrl = useChatStore((s) => s.identity.serverUrl)
  const token = useChatStore((s) => s.identity.token)
  const username = useChatStore((s) => s.identity.username)
  const syncEnabled = useAppStore((s) => s.settings?.browserPrivacy.syncEnabled !== false)

  useEffect(() => {
    if (dataVersion % 2 || !serverUrl || !token || !username || !syncEnabled) return
    const controller = createAccountSync<SyncedBrowserPrivacy>({
      kind: 'browser-privacy',
      serverUrl,
      token,
      pollMs: 30000,
      debounceMs: 700,
      isReady: () => Boolean(useAppStore.getState().settings?.browserPrivacy),
      isActive: () => useAppStore.getState().settings?.browserPrivacy.syncEnabled !== false,
      getLocal: () => browserPrivacySyncPayload(useAppStore.getState().settings!.browserPrivacy),
      getRevision: () => loadRev(serverUrl, username),
      setRevision: (rev) => saveRev(serverUrl, username, rev),
      mergeRemote: async (remote, { scope }) => {
        if (remote.data === null) return
        if (!isSyncedBrowserPrivacy(remote.data)) throw new Error('网页环境同步格式不合法')
        const local = useAppStore.getState().settings!.browserPrivacy
        const merged = mergeBrowserPrivacySync(local, remote.data)
        if (merged === local) return
        await saveBrowserPrivacySettings(scope, merged)
      },
      subscribeLocal: (notify) => useAppStore.subscribe(notify),
    })
    void controller.start()
    return () => controller.stop()
  }, [serverUrl, token, username, syncEnabled, dataVersion])
}
