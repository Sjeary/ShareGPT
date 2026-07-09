import { useEffect } from 'react'
import { api } from '@/lib/api'
import { wsBus } from '@/lib/wsBus'
import { useAppStore } from '@/store/useAppStore'
import { useChatStore } from '@/store/useChatStore'
import type { BrowserPrivacySettings } from '@/types/settings'

const KIND = 'browser-privacy'
const PUSH_DELAY_MS = 700
const POLL_INTERVAL_MS = 30_000

interface SyncedBrowserPrivacy {
  version: 1
  updatedAt: string
  environment: Pick<
    BrowserPrivacySettings['environment'],
    'mode' | 'locale' | 'acceptLanguages' | 'geolocationMode' | 'autoSyncFromProxy'
  > & { timezone?: string }
}

function stable(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function syncPayload(settings: BrowserPrivacySettings): SyncedBrowserPrivacy {
  return {
    version: 1,
    updatedAt: settings.updatedAt,
    environment: {
      mode: settings.environment.mode,
      locale: settings.environment.locale,
      acceptLanguages: settings.environment.acceptLanguages,
      geolocationMode: settings.environment.geolocationMode,
      autoSyncFromProxy: settings.environment.autoSyncFromProxy,
      ...(settings.environment.mode === 'proxy' ? {} : { timezone: settings.environment.timezone }),
    },
  }
}

function isSyncedPayload(value: unknown): value is SyncedBrowserPrivacy {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SyncedBrowserPrivacy>
  return (
    candidate.version === 1 &&
    typeof candidate.updatedAt === 'string' &&
    Boolean(candidate.environment) &&
    typeof candidate.environment === 'object'
  )
}

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

async function applyRemote(remote: SyncedBrowserPrivacy): Promise<void> {
  const local = useAppStore.getState().settings?.browserPrivacy
  if (!local || remote.updatedAt <= local.updatedAt) return
  const remoteMode = ['system', 'us', 'proxy'].includes(remote.environment.mode)
    ? remote.environment.mode
    : local.environment.mode
  const remoteGeolocationMode = ['disabled', 'proxy'].includes(remote.environment.geolocationMode)
    ? remote.environment.geolocationMode
    : local.environment.geolocationMode
  const resetProxyDetection = local.environment.mode !== 'proxy' && remoteMode === 'proxy'
  await useAppStore.getState().patchSection('browserPrivacy', {
    version: 1,
    updatedAt: remote.updatedAt,
    syncEnabled: local.syncEnabled,
    environment: {
      ...local.environment,
      mode: remoteMode,
      locale:
        typeof remote.environment.locale === 'string'
          ? remote.environment.locale
          : local.environment.locale,
      acceptLanguages:
        typeof remote.environment.acceptLanguages === 'string'
          ? remote.environment.acceptLanguages
          : local.environment.acceptLanguages,
      // 代理模式必须继续使用本机节点检测出的时区；美国预设时区才跨设备应用。
      timezone:
        remoteMode === 'proxy' || typeof remote.environment.timezone !== 'string'
          ? local.environment.timezone
          : remote.environment.timezone,
      geolocationMode: remoteGeolocationMode,
      autoSyncFromProxy: Boolean(remote.environment.autoSyncFromProxy),
      ...(resetProxyDetection
        ? {
            sourceIp: '',
            countryCode: '',
            country: '',
            region: '',
            city: '',
            latitude: null,
            longitude: null,
            accuracy: null,
            sourceUpdatedAt: '',
          }
        : {}),
    },
    lastClearedAt: local.lastClearedAt,
  })
  await api.applyBrowserPrivacy().catch(() => undefined)
}

// 同步“浏览器环境策略”，不上传 Cookie、网页登录态、缓存、密码、代理凭据、出口检测结果
// 或本机清理记录。每台设备在 proxy 模式下都必须从自己的当前节点重新检测。
export function useBrowserPrivacySync(): void {
  const serverUrl = useChatStore((state) => state.identity.serverUrl)
  const token = useChatStore((state) => state.identity.token)
  const username = useChatStore((state) => state.identity.username)
  const syncEnabled = useAppStore((state) => state.settings?.browserPrivacy.syncEnabled !== false)

  useEffect(() => {
    if (!serverUrl || !token || !username || !syncEnabled) return

    let cancelled = false
    let supported = false
    let lastSynced = ''
    let pushTimer: number | null = null
    let pollTimer: number | null = null
    let chain: Promise<void> = Promise.resolve()
    const unsubs: Array<() => void> = []

    const authFetch = (init?: RequestInit) =>
      fetch(`${serverUrl}/api/user-store/${KIND}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      })

    const enqueue = (work: () => Promise<void>) => {
      chain = chain.then(work).catch(() => undefined)
      return chain
    }

    async function push(payload: SyncedBrowserPrivacy, baseRev: number, depth = 0): Promise<void> {
      const response = await authFetch({
        method: 'PUT',
        body: JSON.stringify({ baseRev, data: payload }),
      })
      if (response.ok) {
        const body = (await response.json()) as { rev: number }
        saveRev(serverUrl, username, body.rev)
        lastSynced = stable(payload)
        return
      }
      if (response.status === 409 && depth < 2) {
        const conflict = (await response.json()) as { rev: number; data: unknown }
        if (isSyncedPayload(conflict.data)) {
          const local = useAppStore.getState().settings?.browserPrivacy
          if (local && conflict.data.updatedAt > local.updatedAt) {
            await applyRemote(conflict.data)
            saveRev(serverUrl, username, conflict.rev)
            lastSynced = stable(conflict.data)
            return
          }
        }
        await push(payload, conflict.rev, depth + 1)
        return
      }
      throw new Error(`浏览器环境配置同步失败（${response.status}）`)
    }

    async function initialSync(): Promise<void> {
      const response = await authFetch()
      if (!response.ok) return
      supported = true
      const remote = (await response.json()) as { rev: number; data: unknown }
      saveRev(serverUrl, username, remote.rev)
      const local = useAppStore.getState().settings?.browserPrivacy
      if (!local) return
      if (isSyncedPayload(remote.data) && remote.data.updatedAt > local.updatedAt) {
        await applyRemote(remote.data)
        lastSynced = stable(remote.data)
        return
      }
      const payload = syncPayload(local)
      lastSynced = stable(payload)
      if (
        remote.rev === 0 ||
        !isSyncedPayload(remote.data) ||
        payload.updatedAt > remote.data.updatedAt
      ) {
        await push(payload, remote.rev)
      }
    }

    function schedulePush(): void {
      if (!supported || cancelled) return
      const settings = useAppStore.getState().settings?.browserPrivacy
      if (!settings || !settings.syncEnabled) return
      const payload = syncPayload(settings)
      if (!payload.updatedAt || stable(payload) === lastSynced) return
      if (pushTimer) window.clearTimeout(pushTimer)
      pushTimer = window.setTimeout(() => {
        pushTimer = null
        void enqueue(() => push(payload, loadRev(serverUrl, username)))
      }, PUSH_DELAY_MS)
    }

    async function poll(): Promise<void> {
      if (!supported || cancelled) return
      const response = await authFetch()
      if (!response.ok) return
      const remote = (await response.json()) as { rev: number; data: unknown }
      if (remote.rev <= loadRev(serverUrl, username) || !isSyncedPayload(remote.data)) return
      await applyRemote(remote.data)
      saveRev(serverUrl, username, remote.rev)
      lastSynced = stable(remote.data)
    }

    void enqueue(async () => {
      await initialSync()
      if (cancelled || !supported) return
      unsubs.push(useAppStore.subscribe(schedulePush))
      unsubs.push(
        wsBus.subscribe((payload) => {
          if (payload.type !== 'user_store_updated' || payload.kind !== KIND) return
          const rev = typeof payload.rev === 'number' ? payload.rev : 0
          if (rev <= loadRev(serverUrl, username) || !isSyncedPayload(payload.data)) return
          void enqueue(async () => {
            await applyRemote(payload.data as SyncedBrowserPrivacy)
            saveRev(serverUrl, username, rev)
            lastSynced = stable(payload.data)
          })
        }),
      )
      pollTimer = window.setInterval(() => void enqueue(poll), POLL_INTERVAL_MS)
    })

    return () => {
      cancelled = true
      if (pushTimer) window.clearTimeout(pushTimer)
      if (pollTimer) window.clearInterval(pollTimer)
      for (const unsubscribe of unsubs) unsubscribe()
    }
  }, [serverUrl, token, username, syncEnabled])
}
