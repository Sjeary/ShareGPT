export interface NotesAiProviderSnapshot {
  baseUrl: string
  apiKey: string
  model: string
  effort: string
}

export interface NotesAiPrincipalSession {
  principalId: string
  principalGeneration: number
}

export const DEFAULT_NOTES_AI_PROVIDER: NotesAiProviderSnapshot = {
  baseUrl: '',
  apiKey: '',
  model: 'gpt-5.5',
  effort: 'medium',
}

export function notesAiProviderFromSettings(settings?: {
  ai?: Partial<NotesAiProviderSnapshot>
}): NotesAiProviderSnapshot {
  return { ...DEFAULT_NOTES_AI_PROVIDER, ...(settings?.ai || {}) }
}

export function isCurrentNotesAiPrincipal(
  expected: NotesAiPrincipalSession,
  current: NotesAiPrincipalSession,
): boolean {
  return (
    Boolean(expected.principalId) &&
    expected.principalId === current.principalId &&
    expected.principalGeneration === current.principalGeneration
  )
}
