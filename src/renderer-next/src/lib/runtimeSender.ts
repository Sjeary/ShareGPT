import type { AdvancedAiRoute, SenderSettings } from '@/types/settings'
import type { RuntimeSenderConfig } from '@/store/useAuthStore'

const EMPTY_SENDER: SenderSettings = {
  proxy_server: '',
  proxy_port: '',
  proxy_uuid: '',
  socks_listen_port: '',
  fallback_mode: 'system_proxy',
  fallback_local_port: '',
  target_domains: '',
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

export function runtimeSenderForPrincipal(
  local: Partial<SenderSettings> | undefined,
  runtime: RuntimeSenderConfig | null | undefined,
  principalId: string,
): { settings: SenderSettings; serverManaged: boolean } {
  const settings = { ...EMPTY_SENDER, ...(local ?? {}) }
  if (!principalId || runtime?.principalId !== principalId) {
    return { settings, serverManaged: false }
  }

  const server = runtime.sender
  return {
    settings: {
      ...settings,
      // These values are authoritative for the authenticated server. Empty values must also
      // replace an older local value so a removed server credential cannot look usable.
      proxy_server: text(server.proxy_server),
      proxy_port: text(server.proxy_port),
      proxy_uuid: text(server.proxy_uuid),
      proxy_expected_ip: text(server.proxy_expected_ip),
      proxy_expected_country: text(server.proxy_expected_country),
      proxy_expected_asn: text(server.proxy_expected_asn),
      // Operational defaults remain usable on a clean principal without persisting secrets.
      socks_listen_port: text(server.socks_listen_port) || settings.socks_listen_port,
      fallback_mode: text(server.fallback_mode) || settings.fallback_mode,
      fallback_local_port: text(server.fallback_local_port) || settings.fallback_local_port,
      target_domains: text(server.target_domains) || settings.target_domains,
    },
    serverManaged: true,
  }
}

export function authorizedAirportRoute(
  routeAuthorizationVerified: boolean,
  routes: readonly AdvancedAiRoute[] | undefined,
): AdvancedAiRoute | null {
  if (!routeAuthorizationVerified || !Array.isArray(routes)) return null
  return routes.find((route) => route.id === 'internal-airport') ?? null
}
