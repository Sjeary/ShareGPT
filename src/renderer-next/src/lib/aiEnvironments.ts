import type { AdvancedAiEnvironment, AdvancedAiRoute, AdvancedAiSettings } from '@/types/settings'
import type { AiKind } from '@/store/useAiStore'

export const BUILTIN_AI_ROUTES: AdvancedAiRoute[] = [
  { id: 'sender', name: '当前统一代理', mode: 'sender' },
  { id: 'system', name: '系统代理', mode: 'system' },
  { id: 'direct', name: '直连', mode: 'direct' },
]

const KINDS: AiKind[] = ['gpt', 'gemini', 'claude']

function text(value: unknown, maxLength = 80): string {
  return String(value ?? '')
    .trim()
    .slice(0, maxLength)
}

export function createAiEnvironmentId(): string {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12)
  return `env-${random || Date.now().toString(36)}`
}

export function createAiRouteId(): string {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12)
  return `route-${random || Date.now().toString(36)}`
}

export function normalizeAdvancedAiSettings(raw: unknown): AdvancedAiSettings {
  const value = raw && typeof raw === 'object' ? (raw as Partial<AdvancedAiSettings>) : {}
  const routes = Array.isArray(value.routes)
    ? value.routes
        .map((item): AdvancedAiRoute | null => {
          const id = text(item?.id, 48).toLowerCase()
          const name = text(item?.name, 60)
          const port = Number(item?.port)
          if (!/^route-[a-z0-9-]+$/.test(id) || !name || item?.mode !== 'socks5') return null
          if (!Number.isInteger(port) || port < 1 || port > 65535) return null
          return { id, name, mode: 'socks5', host: '127.0.0.1', port }
        })
        .filter((item): item is AdvancedAiRoute => Boolean(item))
    : []
  const routeIds = new Set([
    ...BUILTIN_AI_ROUTES.map((route) => route.id),
    ...routes.map((r) => r.id),
  ])
  const environments = Array.isArray(value.environments)
    ? value.environments
        .map((item): AdvancedAiEnvironment | null => {
          const id = text(item?.id, 48).toLowerCase()
          const kind = text(item?.kind, 16) as AiKind
          if (!/^env-[a-z0-9-]+$/.test(id) || !KINDS.includes(kind)) return null
          const routeId = routeIds.has(text(item?.routeId, 48)) ? text(item?.routeId, 48) : 'sender'
          return {
            id,
            kind,
            name: text(item?.name, 60) || `${kind.toUpperCase()} 环境`,
            routeId,
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
    routes,
    activeByKind,
  }
}

export function routeForEnvironment(
  settings: AdvancedAiSettings,
  environment: AdvancedAiEnvironment | null,
): AdvancedAiRoute {
  const routeId = environment?.routeId || 'sender'
  return (
    settings.routes.find((route) => route.id === routeId) ||
    BUILTIN_AI_ROUTES.find((route) => route.id === routeId) ||
    BUILTIN_AI_ROUTES[0]
  )
}
