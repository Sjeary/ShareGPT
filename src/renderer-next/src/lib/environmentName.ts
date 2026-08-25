export function normalizeEnvironmentNameDraft(draft: string, currentName: string) {
  return draft.trim().slice(0, 60) || currentName
}
