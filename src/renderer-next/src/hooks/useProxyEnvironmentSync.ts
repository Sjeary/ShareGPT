import { useEffect, useRef, useState } from 'react'
import { createAccountScope, type AccountScope } from '@/lib/accountSync'
import { synchronizeProxyEnvironment } from '@/lib/browserPrivacyRuntime'
import { useUserDataTransitionVersion } from '@/lib/userDataTransitionState'

export function useProxyEnvironmentSync() {
  const version = useUserDataTransitionVersion()
  const operation = useRef<AccountScope | null>(null)
  const [busyVersion, setBusyVersion] = useState<number | null>(null)
  useEffect(() => {
    operation.current?.close()
    operation.current = null
    return () => {
      operation.current?.close()
      operation.current = null
    }
  }, [version])

  const synchronize = async () => {
    if (operation.current) return null
    const scope = createAccountScope()
    operation.current = scope
    setBusyVersion(version)
    try {
      return await synchronizeProxyEnvironment(scope, true)
    } catch (error) {
      if (scope.isCurrent()) throw error
      return null
    } finally {
      if (operation.current === scope) {
        operation.current = null
        setBusyVersion(null)
      }
      scope.close()
    }
  }
  return { busy: busyVersion === version, synchronize }
}
