export function shouldShowUnreadMarker(messageId: string, unreadMarkerId: string): boolean {
  return Boolean(messageId && unreadMarkerId && messageId === unreadMarkerId)
}
