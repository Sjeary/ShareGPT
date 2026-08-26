export interface RouteRefreshSession {
  principalId: string
  serverUrl: string
  username: string
  acceptedTokens: readonly string[]
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
