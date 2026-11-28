import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isGlobalShortcutBlockedTarget,
  shouldToggleGlobalCommandPalette,
  type GlobalShortcutEventLike,
  type ShortcutTargetLike,
} from './globalShortcut.ts'

function keyEvent(overrides: Partial<GlobalShortcutEventLike> = {}): GlobalShortcutEventLike {
  return {
    key: 'k',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    isComposing: false,
    repeat: false,
    target: { tagName: 'BODY', closest: () => null },
    ...overrides,
  }
}

function targetWithMatch(
  tagName: string,
  matchedSelectors: string[] = [],
  extra: Partial<ShortcutTargetLike> = {},
): ShortcutTargetLike {
  return {
    tagName,
    closest(selector: string) {
      return matchedSelectors.some((item) => selector.includes(item)) ? {} : null
    },
    ...extra,
  }
}

test('opens global command palette on normal pages with Ctrl+K or Cmd+K', () => {
  assert.equal(
    shouldToggleGlobalCommandPalette(keyEvent({ ctrlKey: true, metaKey: false }), {
      commandPaletteOpen: false,
    }),
    true,
  )
  assert.equal(
    shouldToggleGlobalCommandPalette(
      keyEvent({
        key: 'K',
        ctrlKey: false,
        metaKey: true,
        target: targetWithMatch('BUTTON'),
      }),
      { commandPaletteOpen: false },
    ),
    true,
  )
})

test('ignores already handled, composing, repeated, or non-matching shortcuts', () => {
  for (const event of [
    keyEvent({ defaultPrevented: true }),
    keyEvent({ isComposing: true }),
    keyEvent({ repeat: true }),
    keyEvent({ altKey: true }),
    keyEvent({ shiftKey: true }),
    keyEvent({ ctrlKey: false, metaKey: false }),
    keyEvent({ key: 'p' }),
  ]) {
    assert.equal(shouldToggleGlobalCommandPalette(event, { commandPaletteOpen: false }), false)
  }
})

test('does not hijack editable inputs, CodeMirror editor, terminal, or modal overlays', () => {
  const blockedTargets: ShortcutTargetLike[] = [
    targetWithMatch('INPUT'),
    targetWithMatch('TEXTAREA'),
    targetWithMatch('SELECT'),
    targetWithMatch('DIV', [], { isContentEditable: true }),
    targetWithMatch('SPAN', ['[contenteditable="true"]']),
    targetWithMatch('DIV', ['.cm-editor']),
    targetWithMatch('DIV', ['.xterm']),
    targetWithMatch('DIV', ['[data-terminal-surface="true"]']),
    targetWithMatch('BUTTON', ['[role="dialog"]']),
    targetWithMatch('BUTTON', ['[role="alertdialog"]']),
    targetWithMatch('BUTTON', ['[data-local-shortcut-scope="true"]']),
    { parentElement: targetWithMatch('DIV', ['.cm-editor']) },
  ]
  for (const target of blockedTargets) {
    assert.equal(isGlobalShortcutBlockedTarget(target), true)
    assert.equal(
      shouldToggleGlobalCommandPalette(keyEvent({ target }), { commandPaletteOpen: false }),
      false,
    )
  }
})

test('respects explicit blocked state when closed and falls back to activeElement', () => {
  assert.equal(
    shouldToggleGlobalCommandPalette(keyEvent(), {
      commandPaletteOpen: false,
      blocked: true,
    }),
    false,
  )
  assert.equal(
    shouldToggleGlobalCommandPalette(keyEvent({ target: null }), {
      commandPaletteOpen: false,
      activeElement: targetWithMatch('INPUT'),
    }),
    false,
  )
})

test('still allows Ctrl/Cmd+K to close the global command palette when open', () => {
  const paletteInput = targetWithMatch('INPUT', ['[role="dialog"]'])
  assert.equal(
    shouldToggleGlobalCommandPalette(keyEvent({ target: paletteInput }), {
      commandPaletteOpen: true,
      blocked: true,
    }),
    true,
  )
  assert.equal(
    shouldToggleGlobalCommandPalette(keyEvent({ target: paletteInput, defaultPrevented: true }), {
      commandPaletteOpen: true,
    }),
    false,
  )
  assert.equal(
    shouldToggleGlobalCommandPalette(keyEvent({ target: paletteInput, repeat: true }), {
      commandPaletteOpen: true,
    }),
    false,
  )
})
