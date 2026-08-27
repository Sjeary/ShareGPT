import type {
  AdvancedAiEnvironment,
  AdvancedAiRoute,
  AdvancedAiSettings,
  SenderSettings,
} from '@/types/settings'
import type { AiKind } from '@/store/useAiStore'

const KINDS: AiKind[] = ['gpt', 'gemini', 'claude']
const ROUTE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

function text(value: unknown, maxLength = 80): string {
  return String(value ?? '')
    .trim()
    .slice(0, maxLength)
}

function configKey(value: unknown): string {
  const source = JSON.stringify(value)
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
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

export function availableAiRoutes(
  sender: Partial<SenderSettings> = {},
  runtimeAuthorizedRouteIds?: readonly string[],
): AdvancedAiRoute[] {
  const routes: AdvancedAiRoute[] = []
  const authorizedSource = Array.isArray(runtimeAuthorizedRouteIds)
    ? runtimeAuthorizedRouteIds
    : sender.authorized_proxy_route_ids
  const authorized = Array.isArray(authorizedSource)
    ? new Set(authorizedSource.map((id) => text(id, 64).toLowerCase()))
    : new Set<string>()
  const isAuthorized = (id: string) => authorized.has(id)
  if (hasCompleteUnifiedProxy(sender) && isAuthorized('internal-unified')) {
    routes.push({
      id: 'internal-unified',
      name: '内置统一代理',
      mode: 'singbox',
      configKey: configKey([sender.proxy_server, sender.proxy_port, sender.proxy_uuid]),
    })
  }
  const managed = Array.isArray(sender.managed_proxy_routes) ? sender.managed_proxy_routes : []
  const legacy =
    sender.airport_outbound && typeof sender.airport_outbound === 'object'
      ? [{ id: 'internal-airport', name: sender.airport_name || '内置机场节点', enabled: true }]
      : []
  const seen = new Set(routes.map((route) => route.id))
  for (const route of [...managed, ...legacy]) {
    const id = text(route?.id, 64).toLowerCase()
    if (
      !ROUTE_ID_PATTERN.test(id) ||
      route?.enabled === false ||
      !isAuthorized(id) ||
      seen.has(id)
    ) {
      continue
    }
    seen.add(id)
    routes.push({
      id,
      name: `内置节点 · ${text(route?.name, 80) || id}`,
      mode: 'singbox',
      configKey: configKey([id, 'outbound' in route ? route.outbound : sender.airport_outbound]),
    })
  }
  return routes
}

export function createAiEnvironmentId(): string {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12)
  return `env-${random || Date.now().toString(36)}`
}

export function normalizeAdvancedAiSettings(raw: unknown): AdvancedAiSettings {
  const value = raw && typeof raw === 'object' ? (raw as Partial<AdvancedAiSettings>) : {}
  const normalizedEnvironments = Array.isArray(value.environments)
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
  const environments = [
    ...new Map(
      normalizedEnvironments.map((environment) => [
        `${environment.kind}:${environment.id}`,
        environment,
      ]),
    ).values(),
  ]

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
    initialized:
      value.initialized === true || value.enabled === true || normalizedEnvironments.length > 0,
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
