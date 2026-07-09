import { useEffect, useRef } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'

function senderIsRunning(status: Record<string, unknown>): boolean {
  return Boolean(status.senderRunning)
}

// 用户显式开启后，在代理由“未运行”变为“运行”或节点配置改变时同步一次出口环境。
// 失败保持原配置，不在后台反复请求；设置页仍可手动重试并看到明确错误。
export function useBrowserPrivacyAutoSync(): void {
  const status = useAppStore((state) => state.status)
  const privacy = useAppStore((state) => state.settings?.browserPrivacy)
  const sender = useAppStore((state) => state.settings?.sender)
  const attemptedSignature = useRef('')

  useEffect(() => {
    const running = senderIsRunning(status)
    if (!running) {
      attemptedSignature.current = ''
      return
    }
    if (
      !privacy ||
      privacy.environment.mode !== 'proxy' ||
      !privacy.environment.autoSyncFromProxy
    ) {
      attemptedSignature.current = ''
      return
    }

    const signature = JSON.stringify({
      proxyMode: sender?.proxy_mode ?? 'unified',
      proxyServer: sender?.proxy_server ?? '',
      proxyPort: sender?.proxy_port ?? '',
      airportName: sender?.airport_name ?? '',
      airport: sender?.airport_outbound ?? null,
    })
    if (attemptedSignature.current === signature) return
    attemptedSignature.current = signature

    let cancelled = false
    void api
      .detectProxyEnvironment()
      .then(async (detected) => {
        if (cancelled) return
        const current = useAppStore.getState().settings?.browserPrivacy
        if (!current || current.environment.mode !== 'proxy') return
        await useAppStore.getState().patchSection('browserPrivacy', {
          ...current,
          updatedAt: new Date().toISOString(),
          environment: {
            ...current.environment,
            timezone: detected.timezone,
            latitude: detected.latitude,
            longitude: detected.longitude,
            accuracy: detected.accuracy,
            sourceIp: detected.ip,
            countryCode: detected.countryCode,
            country: detected.country,
            region: detected.region,
            city: detected.city,
            sourceUpdatedAt: detected.checkedAt,
          },
        })
        await api.applyBrowserPrivacy()
      })
      .catch(() => {
        // 自动同步不打扰用户；设置页的手动同步会展示具体错误。
      })

    return () => {
      cancelled = true
    }
  }, [status, privacy, sender])
}
