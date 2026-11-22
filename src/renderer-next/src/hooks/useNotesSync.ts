import { useEffect } from 'react'
import { useUserDataTransitionVersion } from '@/lib/userDataTransitionState'
import { createAccountSync } from '@/lib/accountSync'
import { useNotesSyncStore } from '@/store/useNotesSyncStore'
import { useChatStore } from '@/store/useChatStore'
import { useVaultStore } from '@/store/useVaultStore'
import { type VaultFiles } from '@/lib/notes/merge'

export { useNotesSyncStore, type NotesSyncState } from '@/store/useNotesSyncStore'

function baseKey(principal: string) {
  return `notesync:base:${principal}`
}
function revKey(principal: string) {
  return `notesync:rev:${principal}`
}
function loadBase(principal: string): VaultFiles {
  try {
    return JSON.parse(localStorage.getItem(baseKey(principal)) || '{}') as VaultFiles
  } catch {
    return {}
  }
}
function saveBase(principal: string, files: VaultFiles) {
  try {
    localStorage.setItem(baseKey(principal), JSON.stringify(files))
  } catch {
    /* 配额超限则放弃持久化 base (下次按全量对比, 仍安全) */
  }
}
function loadRev(principal: string): number {
  const v = Number(localStorage.getItem(revKey(principal)))
  return Number.isInteger(v) && v >= 0 ? v : 0
}
function saveRev(principal: string, rev: number) {
  try {
    localStorage.setItem(revKey(principal), String(rev))
  } catch {
    /* ignore */
  }
}
function stable(files: VaultFiles): string {
  return JSON.stringify(
    Object.keys(files)
      .sort()
      .map((k) => [k, files[k]]),
  )
}

export function useNotesSync(): void {
  const dataVersion = useUserDataTransitionVersion()
  const serverUrl = useChatStore((s) => s.identity.serverUrl)
  const token = useChatStore((s) => s.identity.token)
  const username = useChatStore((s) => s.identity.username)
  const vaultRoot = useVaultStore((s) => s.root)
  const vaultLoaded = useVaultStore((s) => s.loaded)

  useEffect(() => {
    useNotesSyncStore.getState().resetForPrincipal()
    const setState = useNotesSyncStore.getState().setState
    if (dataVersion % 2 || !vaultLoaded || !serverUrl || !token) {
      setState('local')
      return
    }
    const controller = createAccountSync<{ files: VaultFiles }>({
      kind: 'notes',
      serverUrl,
      token,
      pollMs: 25000,
      debounceMs: 900,
      isActive: () =>
        useVaultStore.getState().root === vaultRoot && useVaultStore.getState().loaded,
      isReady: () => useVaultStore.getState().loaded,
      getLocal: () => {
        const { rawByPath, currentPath, draft, dirty } = useVaultStore.getState()
        return {
          files: { ...rawByPath, ...(dirty && currentPath ? { [currentPath]: draft } : {}) },
        }
      },
      serialize: (data) => stable(data?.files ?? {}),
      getRevision: ({ snapshot }) => loadRev(snapshot.principalId),
      setRevision: (rev, { snapshot }) => saveRev(snapshot.principalId, rev),
      mergeRemote: async (remote, { scope, previousRevision, conflict }) => {
        if (remote.rev <= previousRevision) return
        const files = remote.data?.files
        if (
          !files ||
          typeof files !== 'object' ||
          Array.isArray(files) ||
          Object.values(files).some((value) => typeof value !== 'string')
        )
          throw new Error('云端笔记格式不合法，已保留本机资料')
        const report = await useVaultStore
          .getState()
          .mergeFromCloud(loadBase(scope.snapshot.principalId), files)
        scope.assertCurrent()
        saveBase(scope.snapshot.principalId, files)
        const incoming = report.fromCloud.length + report.conflicts.length + report.deleted.length
        if (!conflict && incoming > 0) useNotesSyncStore.getState().showReport(report)
        // A new cloud revision is acknowledged with the complete merged vault, as before.
        return { publish: true }
      },
      acknowledge: (sent, _remote, scope) => saveBase(scope.snapshot.principalId, sent.files),
      subscribeLocal: (notify) => useVaultStore.subscribe(notify),
      setState,
    })
    void controller.start()
    return () => controller.stop()
  }, [serverUrl, token, username, dataVersion, vaultRoot, vaultLoaded])
}
