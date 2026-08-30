interface AiCapabilityProfile {
  isAdmin?: boolean
  advancedAiAllowed?: boolean
}

export function canUseTranslation(
  token: string | null | undefined,
  profile: AiCapabilityProfile | null | undefined,
): boolean {
  return Boolean(String(token || '').trim() && profile)
}

export function canUseAdvancedAi(
  token: string | null | undefined,
  profile: AiCapabilityProfile | null | undefined,
): boolean {
  return Boolean(
    canUseTranslation(token, profile) && (profile?.isAdmin || profile?.advancedAiAllowed),
  )
}
