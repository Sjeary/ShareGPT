export interface ShortcutTargetLike {
  tagName?: string
  isContentEditable?: boolean
  parentElement?: ShortcutTargetLike | null
  closest?: (selector: string) => unknown
}

export interface GlobalShortcutEventLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey?: boolean
  defaultPrevented?: boolean
  isComposing?: boolean
  repeat?: boolean
  target?: EventTarget | ShortcutTargetLike | null
}

export interface GlobalCommandPaletteShortcutOptions {
  commandPaletteOpen: boolean
  blocked?: boolean
  activeElement?: EventTarget | ShortcutTargetLike | null
}

const LOCAL_SHORTCUT_SCOPE_SELECTOR = [
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '.cm-editor',
  '.xterm',
  '[data-terminal-surface="true"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[data-local-shortcut-scope="true"]',
].join(', ')

function toElementLike(
  candidate: EventTarget | ShortcutTargetLike | null | undefined,
): ShortcutTargetLike | null {
  if (!candidate || typeof candidate !== 'object') return null
  const node = candidate as ShortcutTargetLike
  if (typeof node.tagName === 'string' || typeof node.closest === 'function') return node
  if (node.parentElement && typeof node.parentElement === 'object') return node.parentElement
  return null
}

export function isGlobalShortcutBlockedTarget(
  target: EventTarget | ShortcutTargetLike | null | undefined,
): boolean {
  const el = toElementLike(target)
  if (!el) return false
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : ''
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  if (typeof el.closest === 'function' && Boolean(el.closest(LOCAL_SHORTCUT_SCOPE_SELECTOR)))
    return true
  return false
}

export function shouldToggleGlobalCommandPalette(
  event: GlobalShortcutEventLike,
  options: GlobalCommandPaletteShortcutOptions,
): boolean {
  if (event.defaultPrevented || event.isComposing || event.repeat) return false
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false
  if (event.key.toLowerCase() !== 'k') return false
  if (options.commandPaletteOpen) return true
  if (options.blocked) return false
  const target = toElementLike(event.target) ?? toElementLike(options.activeElement)
  return !isGlobalShortcutBlockedTarget(target)
}
