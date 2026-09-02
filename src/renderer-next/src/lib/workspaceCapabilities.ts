import type { NavKey } from '@/lib/nav'

export type WorkspaceMode = 'chooser' | 'personal' | 'organization'

export type WorkspaceModuleId =
  | 'network'
  | 'collaboration'
  | 'personal-organizer'
  | 'team-calendar'
  | 'notes'
  | 'focus'
  | 'embedded-ai'
  | 'usage'
  | 'account'
  | 'logs'

export interface WorkspaceModuleDefinition {
  id: WorkspaceModuleId
  personal: boolean
  organization: boolean
}

export const WORKSPACE_MODULES: readonly WorkspaceModuleDefinition[] = [
  { id: 'network', personal: true, organization: true },
  { id: 'collaboration', personal: false, organization: true },
  { id: 'personal-organizer', personal: true, organization: true },
  { id: 'team-calendar', personal: false, organization: true },
  { id: 'notes', personal: true, organization: true },
  { id: 'focus', personal: true, organization: true },
  { id: 'embedded-ai', personal: true, organization: true },
  { id: 'usage', personal: false, organization: true },
  { id: 'account', personal: true, organization: true },
  { id: 'logs', personal: true, organization: true },
] as const

const MODULE_BY_ID = new Map(WORKSPACE_MODULES.map((module) => [module.id, module]))

const NAV_MODULE: Record<NavKey, WorkspaceModuleId> = {
  service: 'network',
  chat: 'collaboration',
  calendar: 'personal-organizer',
  team: 'team-calendar',
  todo: 'personal-organizer',
  notes: 'notes',
  focus: 'focus',
  gpt: 'embedded-ai',
  gemini: 'embedded-ai',
  claude: 'embedded-ai',
  stats: 'usage',
  account: 'account',
  logs: 'logs',
}

export function workspaceModuleAvailable(
  mode: WorkspaceMode,
  moduleId: WorkspaceModuleId,
  options: { chatDisabled?: boolean } = {},
): boolean {
  const module = MODULE_BY_ID.get(moduleId)
  if (!module || mode === 'chooser') return false
  if (mode === 'personal') return module.personal
  if (moduleId === 'collaboration' && options.chatDisabled) return false
  return module.organization
}

export function workspaceNavAvailable(
  mode: WorkspaceMode,
  key: NavKey,
  options: { chatDisabled?: boolean } = {},
): boolean {
  return workspaceModuleAvailable(mode, NAV_MODULE[key], options)
}

export function workspaceFallbackNav(mode: WorkspaceMode): NavKey {
  return mode === 'chooser' ? 'account' : 'service'
}

export function canStartWorkspaceProxy(mode: WorkspaceMode, collaborationOnline: boolean): boolean {
  return mode === 'personal' || (mode === 'organization' && collaborationOnline)
}
