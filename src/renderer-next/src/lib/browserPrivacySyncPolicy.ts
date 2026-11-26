import type { BrowserPrivacySettings } from '@/types/settings'

export interface SyncedBrowserPrivacy {
  version: 1
  updatedAt: string
  environment: Pick<
    BrowserPrivacySettings['environment'],
    'mode' | 'locale' | 'acceptLanguages' | 'geolocationMode' | 'autoSyncFromProxy'
  > & { timezone?: string }
  fingerprint?: BrowserPrivacySettings['fingerprint']
}

export function browserPrivacySyncPayload(settings: BrowserPrivacySettings): SyncedBrowserPrivacy {
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
    fingerprint: settings.fingerprint,
  }
}

export function isSyncedBrowserPrivacy(value: unknown): value is SyncedBrowserPrivacy {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SyncedBrowserPrivacy>
  return (
    candidate.version === 1 &&
    typeof candidate.updatedAt === 'string' &&
    Boolean(candidate.environment) &&
    typeof candidate.environment === 'object' &&
    !Array.isArray(candidate.environment)
  )
}

// The runtime and tests share this policy. Device-derived data never comes from another device.
export function mergeBrowserPrivacySync(
  local: BrowserPrivacySettings,
  remote: SyncedBrowserPrivacy,
): BrowserPrivacySettings {
  if (remote.updatedAt <= local.updatedAt) return local
  const mode = ['system', 'us', 'proxy'].includes(remote.environment.mode)
    ? remote.environment.mode
    : local.environment.mode
  const geolocationMode = ['disabled', 'proxy'].includes(remote.environment.geolocationMode)
    ? remote.environment.geolocationMode
    : local.environment.geolocationMode
  const keepDetection = local.environment.mode === 'proxy' && mode === 'proxy'
  return {
    ...local,
    updatedAt: remote.updatedAt,
    environment: {
      ...local.environment,
      mode,
      locale:
        typeof remote.environment.locale === 'string'
          ? remote.environment.locale
          : local.environment.locale,
      acceptLanguages:
        typeof remote.environment.acceptLanguages === 'string'
          ? remote.environment.acceptLanguages
          : local.environment.acceptLanguages,
      timezone:
        mode === 'proxy' || typeof remote.environment.timezone !== 'string'
          ? local.environment.timezone
          : remote.environment.timezone,
      geolocationMode,
      autoSyncFromProxy: Boolean(remote.environment.autoSyncFromProxy),
      ...(keepDetection
        ? {}
        : {
            sourceIp: '',
            countryCode: '',
            country: '',
            region: '',
            city: '',
            latitude: null,
            longitude: null,
            accuracy: null,
            sourceUpdatedAt: '',
          }),
    },
    fingerprint:
      remote.fingerprint && typeof remote.fingerprint === 'object'
        ? { ...local.fingerprint, ...remote.fingerprint }
        : local.fingerprint,
  }
}
