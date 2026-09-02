interface AiCapabilityProfile {
  isAdmin?: boolean
  advancedAiAllowed?: boolean
}

type AiWorkspaceMode = 'chooser' | 'personal' | 'organization'

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
