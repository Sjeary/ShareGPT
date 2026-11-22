import { api } from '@/lib/api'
import type { AccountScope } from '@/lib/accountSync'
import { useAppStore } from '@/store/useAppStore'
import type { BrowserPrivacySettings, SenderSettings } from '@/types/settings'

export function proxyEnvironmentBinding(sender: Partial<SenderSettings> = {}): string {
  return JSON.stringify({
    proxyMode: sender.proxy_mode ?? 'unified',
    proxyServer: sender.proxy_server ?? '',
    proxyPort: sender.proxy_port ?? '',
    personalProtocol: sender.personal_proxy_protocol ?? 'socks5',
    personalHost: sender.personal_proxy_host ?? '',
    personalPort: sender.personal_proxy_port ?? '',
    airportName: sender.airport_name ?? '',
    airport: sender.airport_outbound ?? null,
  })
}

export async function saveBrowserPrivacySettings(
  scope: AccountScope,
  next: BrowserPrivacySettings,
  apply = true,
): Promise<void> {
  scope.assertCurrent()
  await useAppStore.getState().patchSection('browserPrivacy', next, scope.snapshot)
  scope.assertCurrent()
  if (apply) {
    const result = await api.applyBrowserPrivacy()
    scope.assertCurrent()
    if (!result.ok) throw new Error('部分已打开的网页环境应用失败，请关闭网页标签后重试')
  }
}

export async function synchronizeProxyEnvironment(scope: AccountScope, activateProxy = false) {
  scope.assertCurrent()
  const binding = proxyEnvironmentBinding(useAppStore.getState().settings?.sender)
  const detected = await api.detectProxyEnvironment()
  scope.assertCurrent()
  const settings = useAppStore.getState().settings
  if (proxyEnvironmentBinding(settings?.sender) !== binding)
    throw new Error('代理线路已变化，请重新同步出口环境')
  const current = settings?.browserPrivacy
  if (!current) throw new Error('网页环境配置尚未就绪')
  await saveBrowserPrivacySettings(scope, {
    ...current,
    updatedAt: new Date().toISOString(),
    environment: {
      ...current.environment,
      ...(activateProxy
        ? { mode: 'proxy' as const, locale: 'en-US', acceptLanguages: 'en-US,en' }
        : {}),
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
  return detected
}
