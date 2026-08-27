import type { AuthProfile } from '@/store/useAuthStore'

type AiAccessProfile = Pick<
  AuthProfile,
  'username' | 'isAdmin' | 'advancedAiAllowed' | 'routeAuthorizationVerified'
>

export function canUseTranslation(
  profile: AiAccessProfile | null | undefined,
  token: string | null | undefined,
): boolean {
  return Boolean(String(profile?.username || '').trim() && String(token || '').trim())
}

export function canUseAdvancedAi(
  profile: AiAccessProfile | null | undefined,
  token: string | null | undefined,
): boolean {
  return Boolean(
    canUseTranslation(profile, token) &&
    profile?.routeAuthorizationVerified &&
    (profile.isAdmin || profile.advancedAiAllowed),
  )
}
