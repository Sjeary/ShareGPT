export const PROXY_AUTHORIZATION_UNAVAILABLE = 'proxy_authorization_unavailable'

type BootstrapRecord = Record<string, unknown>

export interface ProxyBootstrapCompatibility {
  allowLegacyAdminConfig?: boolean
}

function objectRecord(value: unknown): BootstrapRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as BootstrapRecord)
    : null
}

export function hasAuthoritativeProxyBootstrap(raw: unknown): boolean {
  const payload = objectRecord(raw)
  if (!payload || !Array.isArray(payload.proxyRoutes)) return false

  const capabilities = objectRecord(payload.capabilities)
  const proxyRoutes = objectRecord(capabilities?.proxyRoutes)
  if (!proxyRoutes) return true

  return proxyRoutes.available === true && proxyRoutes.authoritative === true
}

function hasCompleteLegacySender(payload: BootstrapRecord): boolean {
  const sender = objectRecord(payload.sender)
  return Boolean(sender?.proxy_server && sender?.proxy_port && sender?.proxy_uuid)
}

export function hasLegacyAdminProxyBootstrap(raw: unknown): boolean {
  const payload = objectRecord(raw)
  if (!payload || Array.isArray(payload.proxyRoutes)) return false
  const capabilities = objectRecord(payload.capabilities)
  if (objectRecord(capabilities?.proxyRoutes)) return false
  const airport = objectRecord(payload.airport)
  return hasCompleteLegacySender(payload) || Boolean(objectRecord(airport?.outbound))
}

export function isAcceptedProxyBootstrap(
  raw: unknown,
  compatibility: ProxyBootstrapCompatibility = {},
): boolean {
  return (
    hasAuthoritativeProxyBootstrap(raw) ||
    (compatibility.allowLegacyAdminConfig === true && hasLegacyAdminProxyBootstrap(raw))
  )
}

export function proxyAuthorizationInvalidationPatch(): {
  authorized_proxy_route_ids: string[]
} {
  return { authorized_proxy_route_ids: [] }
}

export async function runAuthoritativeBootstrapRefresh<T>(options: {
  invalidate: () => Promise<void>
  fetchBootstrap: () => Promise<unknown>
  applyBootstrap: (raw: unknown) => Promise<T>
  compatibility?: ProxyBootstrapCompatibility
  assertCurrent?: () => void | Promise<void>
}): Promise<T> {
  await options.assertCurrent?.()
  await options.invalidate()
  await options.assertCurrent?.()
  const raw = await options.fetchBootstrap()
  await options.assertCurrent?.()
  if (!isAcceptedProxyBootstrap(raw, options.compatibility)) {
    throw new Error(PROXY_AUTHORIZATION_UNAVAILABLE)
  }
  const result = await options.applyBootstrap(raw)
  await options.assertCurrent?.()
  return result
}

export async function invalidateProxyAuthorization(options: {
  clearMemory: () => void
  persistClearedAuthorization: () => Promise<void>
  stopSender: () => Promise<unknown>
}): Promise<void> {
  options.clearMemory()
  let persistenceError: unknown = null
  try {
    await options.persistClearedAuthorization()
  } catch (error) {
    persistenceError = error
  }
  await options.stopSender().catch(() => undefined)
  if (persistenceError) throw persistenceError
}
