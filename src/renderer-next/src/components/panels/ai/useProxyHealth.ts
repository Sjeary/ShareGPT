import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { createAccountScope, type AccountScope } from '@/lib/accountSync'
import { coalesceInFlight } from '@/lib/inFlightRequest'
import { showErrorToast } from '@/lib/errorToast'
import { useUserDataTransitionVersion } from '@/lib/userDataTransitionState'
import { useAppStore } from '@/store/useAppStore'
import { useAiStore, type AiKind } from '@/store/useAiStore'
import type { AiProxyReport } from '@/types/api'
import { reportMissingDomains } from './reportGptUsage'

interface ProxyHealthOptions {
  kind: AiKind
  tabId: string
  environmentId: string
  networkReady: boolean
  initialized: boolean
  advancedMode: boolean
}

export function useProxyHealth({
  kind,
  tabId,
  environmentId,
  networkReady,
  initialized,
  advancedMode,
}: ProxyHealthOptions) {
  const version = useUserDataTransitionVersion()
  const key = JSON.stringify([version, kind, tabId, environmentId])
  const pending = useRef(new Set<AccountScope>())
  const inFlight = useRef(new Map<string, Promise<void>>())
  const retryTimer = useRef<number | null>(null)
  const reported = useRef(new Set<string>())
  const [proxyOpen, setProxyOpen] = useState(false)
  const [checking, setChecking] = useState<{ key: string; scope: AccountScope } | null>(null)
  const [report, setReport] = useState<{ key: string; value: AiProxyReport } | null>(null)
  const [restarting, setRestarting] = useState<{ key: string; scope: AccountScope } | null>(null)
  const proxyReport = report?.key === key ? report.value : null

  useEffect(
    () => () => {
      for (const scope of pending.current) scope.close()
      pending.current.clear()
      inFlight.current.clear()
      reported.current.clear()
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current)
    },
    [key],
  )

  const runProxyCheck = useCallback(
    () =>
      coalesceInFlight(inFlight.current, key, async () => {
        const scope = createAccountScope(
          () => useAiStore.getState().activeTabIdByKind[kind] === tabId,
        )
        pending.current.add(scope)
        if (!scope.isCurrent()) {
          pending.current.delete(scope)
          scope.close()
          return
        }
        setChecking({ key, scope })
        try {
          const value = await api.checkAiProxy(kind, tabId)
          scope.assertCurrent()
          setReport({ key, value })
        } catch (error) {
          if (scope.isCurrent())
            setReport({
              key,
              value: { ok: false, reason: error instanceof Error ? error.message : String(error) },
            })
        } finally {
          if (scope.isCurrent())
            setChecking((current) => (current?.scope === scope ? null : current))
          pending.current.delete(scope)
          scope.close()
        }
      }),
    [key, kind, tabId],
  )

  const toggleProxyPanel = useCallback(() => {
    const next = !proxyOpen
    setProxyOpen(next)
    if (next) void runProxyCheck()
  }, [proxyOpen, runProxyCheck])

  useEffect(() => {
    if (!networkReady || !initialized || !tabId) return
    const timer = window.setInterval(() => void runProxyCheck(), 20000)
    return () => window.clearInterval(timer)
  }, [networkReady, initialized, tabId, runProxyCheck])

  const fallbackDomains = useMemo(
    () =>
      Array.from(
        new Set(
          (proxyReport?.hosts ?? [])
            .filter((host) => host.via === 'fallback')
            .map((host) => String(host.host || '').trim())
            .filter(Boolean),
        ),
      ),
    [proxyReport],
  )
  useEffect(() => {
    if (advancedMode || !fallbackDomains.length) return
    const scope = createAccountScope()
    if (!scope.isCurrent()) {
      scope.close()
      return
    }
    const existing = new Set(useAppStore.getState().settings?.sender.auto_domains ?? [])
    const fresh = fallbackDomains.filter((domain) => !existing.has(domain))
    if (fresh.length)
      void useAppStore
        .getState()
        .patchSection('sender', { auto_domains: [...existing, ...fresh] }, scope.snapshot)
        .catch(() => undefined)
    const missing = fallbackDomains.filter((domain) => !reported.current.has(domain))
    if (missing.length) {
      missing.forEach((domain) => reported.current.add(domain))
      void reportMissingDomains(missing)
    }
    return () => scope.close()
  }, [advancedMode, fallbackDomains])

  const applyMissingDomains = useCallback(async () => {
    const scope = createAccountScope()
    pending.current.add(scope)
    const sender = useAppStore.getState().settings?.sender
    if (!sender || !scope.isCurrent()) {
      pending.current.delete(scope)
      scope.close()
      return
    }
    setRestarting({ key, scope })
    try {
      await api.startSender(sender)
      scope.assertCurrent()
      toast.success('已加入并重启代理，正在重新检测…')
      retryTimer.current = window.setTimeout(() => {
        retryTimer.current = null
        void runProxyCheck()
      }, 1500)
    } catch (error) {
      if (scope.isCurrent()) showErrorToast(error, '重启代理')
    } finally {
      if (scope.isCurrent()) setRestarting((current) => (current?.scope === scope ? null : current))
      pending.current.delete(scope)
      scope.close()
    }
  }, [key, runProxyCheck])

  return {
    proxyOpen,
    setProxyOpen,
    proxyChecking: checking?.key === key && checking.scope.isCurrent(),
    proxyReport,
    runProxyCheck,
    toggleProxyPanel,
    restartingProxy: restarting?.key === key && restarting.scope.isCurrent(),
    applyMissingDomains,
  }
}
