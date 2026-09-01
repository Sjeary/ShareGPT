import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TRANSLATION_PANEL_DEFAULT_WIDTH,
  TRANSLATION_PANEL_MAX_WIDTH,
  TRANSLATION_PANEL_MIN_WIDTH,
  normalizeTranslationPanelWidth,
  resolveTranslationPanelLayout,
} from './translationPanelLayout.ts'

test('translation panel keeps the preferred width when the workspace has room', () => {
  assert.deepEqual(resolveTranslationPanelLayout(1200, 456), {
    mode: 'split',
    panelWidth: 456,
    maximumPanelWidth: 714,
  })
})

test('translation panel clamps persisted and effective widths', () => {
  assert.equal(normalizeTranslationPanelWidth(null), TRANSLATION_PANEL_DEFAULT_WIDTH)
  assert.equal(normalizeTranslationPanelWidth(undefined), TRANSLATION_PANEL_DEFAULT_WIDTH)
  assert.equal(normalizeTranslationPanelWidth(''), TRANSLATION_PANEL_DEFAULT_WIDTH)
  assert.equal(normalizeTranslationPanelWidth('   '), TRANSLATION_PANEL_DEFAULT_WIDTH)
  assert.equal(normalizeTranslationPanelWidth('invalid'), TRANSLATION_PANEL_DEFAULT_WIDTH)
  assert.equal(normalizeTranslationPanelWidth(100), TRANSLATION_PANEL_MIN_WIDTH)
  assert.equal(normalizeTranslationPanelWidth(900), TRANSLATION_PANEL_MAX_WIDTH)
  assert.deepEqual(resolveTranslationPanelLayout(900, 720), {
    mode: 'split',
    panelWidth: 414,
    maximumPanelWidth: 414,
  })
})

test('translation panel replaces the native browser host in narrow workspaces', () => {
  assert.deepEqual(resolveTranslationPanelLayout(819, 400), {
    mode: 'replace',
    panelWidth: 819,
    maximumPanelWidth: 819,
  })
  assert.equal(resolveTranslationPanelLayout(820, 400).mode, 'split')
})
