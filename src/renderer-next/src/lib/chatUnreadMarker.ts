// Choose one row in display order, even when cached rows contain duplicate IDs.
// History and presence cannot substitute for an unread message that was trimmed.
export function unreadMarkerIndex(
  messages: readonly { id: string; system?: boolean }[],
  unreadIds: readonly string[] = [],
): number {
  const pending = new Set(unreadIds)
  return messages.findIndex((message) =>
    Boolean(message.id && !message.system && pending.has(message.id)),
  )
}
