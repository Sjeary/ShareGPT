import type { SenderSettings } from '@/types/settings'

interface ProxyEditorProfile {
  isAdmin?: boolean
  advancedAiAllowed?: boolean
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

export function canEditManagedProxy(profile: ProxyEditorProfile | null | undefined): boolean {
  return Boolean(profile?.isAdmin || profile?.advancedAiAllowed)
}

export function hasCompleteManagedProxy(sender: Partial<SenderSettings> = {}): boolean {
  return Boolean(text(sender.proxy_server) && text(sender.proxy_port) && text(sender.proxy_uuid))
}

export function shouldApplyManagedProxy(
  current: Partial<SenderSettings>,
  incoming: Partial<SenderSettings>,
  editable: boolean,
): boolean {
  if (!hasCompleteManagedProxy(incoming)) return false
  return !editable || !hasCompleteManagedProxy(current)
}
