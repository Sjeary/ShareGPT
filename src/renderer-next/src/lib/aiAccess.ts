interface AiCapabilityProfile {
  isAdmin?: boolean
  advancedAiAllowed?: boolean
}

type AiWorkspaceMode = 'chooser' | 'personal' | 'organization'
type ExternalBrowsingAiKind = 'gpt' | 'gemini' | 'claude'

export function canUseTranslation(
  workspaceMode: AiWorkspaceMode,
  token: string | null | undefined,
  profile: AiCapabilityProfile | null | undefined,
): boolean {
  if (workspaceMode === 'personal') return true
  return workspaceMode === 'organization' && Boolean(String(token || '').trim() && profile)
}

export function canUseAdvancedAi(
  workspaceMode: AiWorkspaceMode,
  token: string | null | undefined,
  profile: AiCapabilityProfile | null | undefined,
): boolean {
  return Boolean(
    canUseTranslation(workspaceMode, token, profile) &&
    workspaceMode === 'organization' &&
    (profile?.isAdmin || profile?.advancedAiAllowed),
  )
}

export function canBrowseExternalWeb(
  kind: ExternalBrowsingAiKind,
  workspaceMode: AiWorkspaceMode,
  token: string | null | undefined,
  profile: AiCapabilityProfile | null | undefined,
  advancedAiEnabled: boolean,
): boolean {
  if (kind === 'claude') return true
  if (kind !== 'gpt') return false
  if (workspaceMode === 'personal') return true
  return advancedAiEnabled && canUseAdvancedAi(workspaceMode, token, profile)
}
