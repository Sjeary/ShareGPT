import { useEffect } from 'react'
import { useUserDataTransitionVersion } from '@/lib/userDataTransitionState'
import { createAccountSync } from '@/lib/accountSync'
import { useChatStore } from '@/store/useChatStore'
import { useCalendarStore } from '@/store/useCalendarStore'
import { useTasksStore } from '@/store/useTasksStore'
import { KIND_CONFIGS, getStoredRev, setStoredRev, useSyncStatus } from '@/lib/cloudSync'

export function useCloudSync(): void {
  const dataVersion = useUserDataTransitionVersion()
  const serverUrl = useChatStore((s) => s.identity.serverUrl)
  const token = useChatStore((s) => s.identity.token)
  const username = useChatStore((s) => s.identity.username)

  useEffect(() => {
    const setState = useSyncStatus.getState().setState
    if (dataVersion % 2 || !serverUrl || !token) {
      setState('calendar', 'local')
      setState('tasks', 'local')
      return
    }
    let cancelled = false
    const controllers = (['calendar', 'tasks'] as const).map((kind) => {
      const cfg = KIND_CONFIGS[kind]
      return createAccountSync<ReturnType<typeof cfg.getLocal>>({
        kind,
        serverUrl,
        token,
        pollMs: 20000,
        debounceMs: 800,
        isReady: cfg.isLoaded,
        getLocal: cfg.getLocal,
        getRevision: ({ snapshot }) => getStoredRev(snapshot.principalId, kind),
        setRevision: (rev, { snapshot }) => setStoredRev(snapshot.principalId, kind, rev),
        mergeRemote: (remote, { scope }) => {
          if (remote.rev > 0 && remote.data)
            cfg.apply(cfg.merge(cfg.getLocal() as never, remote.data) as never, scope.snapshot)
        },
        acknowledge: (_sent, remote, scope) => {
          if (remote.data)
            cfg.apply(cfg.merge(cfg.getLocal() as never, remote.data) as never, scope.snapshot)
        },
        subscribeLocal: cfg.subscribe,
        setState: (state) => setState(kind, state),
      })
    })
    void (async () => {
      await Promise.all([
        useCalendarStore.getState().init(),
        useTasksStore.getState().init(),
      ]).catch(() => undefined)
      for (const controller of controllers) {
        if (cancelled) return
        await controller.start()
      }
    })()
    return () => {
      cancelled = true
      controllers.forEach((controller) => controller.stop())
    }
  }, [serverUrl, token, username, dataVersion])
}
