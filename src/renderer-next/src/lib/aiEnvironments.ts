import type {
  AdvancedAiEnvironment,
  AdvancedAiRoute,
  AdvancedAiSettings,
  SenderSettings,
} from '@/types/settings'
import type { AiKind } from '@/store/useAiStore'

const KINDS: AiKind[] = ['gpt', 'gemini', 'claude']

function text(value: unknown, maxLength = 80): string {
  return String(value ?? '')
    .trim()
    .slice(0, maxLength)
}

function hasCompleteUnifiedProxy(sender: Partial<SenderSettings>): boolean {
  const port = Number(sender.proxy_port)
  return Boolean(
    text(sender.proxy_server, 240) &&
    Number.isInteger(port) &&
    port >= 1 &&
    port <= 65535 &&
    text(sender.proxy_uuid, 160),
  )
}

export function availableAiRoutes(sender: Partial<SenderSettings> = {}): AdvancedAiRoute[] {
  const routes: AdvancedAiRoute[] = []
  const authorized = Array.isArray(sender.authorized_proxy_route_ids)
    ? new Set(sender.authorized_proxy_route_ids)
    : null
  const isAuthorized = (id: string) => !authorized || authorized.has(id)
  if (hasCompleteUnifiedProxy(sender) && isAuthorized('internal-unified')) {
    routes.push({ id: 'internal-unified', name: '内置统一代理', mode: 'singbox' })
  }
  const managed = Array.isArray(sender.managed_proxy_routes) ? sender.managed_proxy_routes : []
  const legacy =
    sender.airport_outbound && typeof sender.airport_outbound === 'object'
      ? [{ id: 'internal-airport', name: sender.airport_name || '内置机场节点', enabled: true }]
      : []
  for (const route of [...managed, ...legacy]) {
    const id = text(route?.id, 64).toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || route?.enabled === false || !isAuthorized(id))
      if (routes.some((candidate) => candidate.id === id)) continue
    routes.push({ id, name: `内置节点 · ${text(route?.name, 80) || id}`, mode: 'singbox' })
  }
  return routes
}

export function createAiEnvironmentId(): string {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12)
  return `env-${random || Date.now().toString(36)}`
}

export function normalizeAdvancedAiSettings(raw: unknown): AdvancedAiSettings {
  const value = raw && typeof raw === 'object' ? (raw as Partial<AdvancedAiSettings>) : {}
  const environments = Array.isArray(value.environments)
    ? value.environments
        .map((item): AdvancedAiEnvironment | null => {
          const id = text(item?.id, 48).toLowerCase()
          const kind = text(item?.kind, 16) as AiKind
          if (!/^env-[a-z0-9-]+$/.test(id) || !KINDS.includes(kind)) return null
          const requestedRouteId = text(item?.routeId, 64).toLowerCase()
          return {
            id,
            kind,
            name: text(item?.name, 60) || `${kind.toUpperCase()} 环境`,
            routeId: /^[a-z0-9][a-z0-9-]{0,63}$/.test(requestedRouteId) ? requestedRouteId : '',
            createdAt: text(item?.createdAt, 40) || new Date().toISOString(),
          }
        })
        .filter((item): item is AdvancedAiEnvironment => Boolean(item))
    : []

  const activeByKind = { gpt: '', gemini: '', claude: '' }
  for (const kind of KINDS) {
    const requested = text(value.activeByKind?.[kind], 48)
    activeByKind[kind] = environments.some(
      (environment) => environment.kind === kind && environment.id === requested,
    )
      ? requested
      : environments.find((environment) => environment.kind === kind)?.id || ''
  }

  return {
    version: 1,
    enabled: value.enabled === true,
    environments,
    activeByKind,
  }
}

export function routeForEnvironment(
  routes: AdvancedAiRoute[],
  environment: AdvancedAiEnvironment | null,
): AdvancedAiRoute | null {
  if (!routes.length || !environment) return null
  return routes.find((route) => route.id === environment.routeId) || null
}
