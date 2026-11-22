import { useEffect, useRef } from 'react'
import { createAccountScope } from '@/lib/accountSync'
import { proxyEnvironmentBinding, synchronizeProxyEnvironment } from '@/lib/browserPrivacyRuntime'
import { useUserDataTransitionVersion } from '@/lib/userDataTransitionState'
import { useAppStore } from '@/store/useAppStore'

export function useBrowserPrivacyAutoSync(): void {
  const version = useUserDataTransitionVersion()
  const running = useAppStore((s) => Boolean(s.status.senderRunning))
  const mode = useAppStore((s) => s.settings?.browserPrivacy.environment.mode)
  const enabled = useAppStore((s) => s.settings?.browserPrivacy.environment.autoSyncFromProxy)
  const sender = useAppStore((s) => s.settings?.sender)
  const binding = proxyEnvironmentBinding(sender)
  const attempted = useRef('')
  useEffect(() => {
    if (version % 2 || !running || mode !== 'proxy' || !enabled) {
      attempted.current = ''
      return
    }
    const scope = createAccountScope(() => {
      const settings = useAppStore.getState().settings
      return (
        settings?.browserPrivacy.environment.mode === 'proxy' &&
        settings.browserPrivacy.environment.autoSyncFromProxy &&
        proxyEnvironmentBinding(settings.sender) === binding
      )
    })
    const key = JSON.stringify([scope.snapshot, binding])
    if (attempted.current === key) {
      scope.close()
      return
    }
    attempted.current = key
    // Only routing/ownership changes restart a detection; unrelated status/settings do not cancel it.
    void synchronizeProxyEnvironment(scope).catch(() => undefined)
    return () => scope.close()
  }, [running, mode, enabled, binding, version])
}
