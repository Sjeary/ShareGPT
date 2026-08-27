export interface RouteRefreshSession {
  principalId: string
  serverUrl: string
  username: string
  acceptedTokens: readonly string[]
}

export interface RuntimeAuthorization {
  eligible?: boolean
  advancedAllowed?: boolean
  isAdmin?: boolean
  allowedProxyRouteIds?: string[]
  authorizedAiRoutes?: Array<{
    id: string
    name: string
    mode: 'singbox'
    configKey: string
  }>
}

export function withRuntimeAuthorization<T extends object>(
  profile: T,
  authorization: RuntimeAuthorization,
) {
  const isAdmin = authorization.isAdmin === true
  return {
    ...profile,
    isAdmin,
    advancedAiAllowed: isAdmin || authorization.advancedAllowed === true,
    routeAuthorizationVerified: authorization.eligible === true,
    allowedProxyRouteIds: Array.isArray(authorization.allowedProxyRouteIds)
      ? authorization.allowedProxyRouteIds
      : [],
    authorizedAiRoutes: Array.isArray(authorization.authorizedAiRoutes)
      ? authorization.authorizedAiRoutes
      : [],
  }
}

export interface CurrentRouteSession {
  principalId: string
  serverUrl: string
  username: string
  token: string
}

export function isCurrentRouteRefreshSession(
  captured: RouteRefreshSession,
  current: CurrentRouteSession,
): boolean {
  return Boolean(
    captured.principalId &&
    current.principalId === captured.principalId &&
    current.serverUrl === captured.serverUrl &&
    current.username === captured.username &&
    current.token &&
    captured.acceptedTokens.includes(current.token),
  )
}
