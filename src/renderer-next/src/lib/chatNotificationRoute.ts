export interface ChatNotificationRoute {
  scope?: string
  targetUsername?: string
  from?: string
  roomScope?: string
  messageId?: string
}

export interface ChatNotificationDestination {
  activeKey: string
  messageId: string
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function resolveChatNotificationDestination(
  route: ChatNotificationRoute = {},
): ChatNotificationDestination {
  const targetUsername = safeText(route.targetUsername || route.from)
  return {
    activeKey:
      safeText(route.scope) === 'private' && targetUsername ? `user:${targetUsername}` : '',
    messageId: safeText(route.messageId),
  }
}
