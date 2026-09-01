export const TRANSLATION_PANEL_DEFAULT_WIDTH = 400
export const TRANSLATION_PANEL_MIN_WIDTH = 320
export const TRANSLATION_PANEL_MAX_WIDTH = 720
export const TRANSLATION_WEB_MIN_WIDTH = 480
export const TRANSLATION_SPLITTER_WIDTH = 6
export const TRANSLATION_SPLIT_MIN_WIDTH = 820

export type TranslationPanelLayout =
  | { mode: 'split'; panelWidth: number; maximumPanelWidth: number }
  | { mode: 'replace'; panelWidth: number; maximumPanelWidth: number }

export function normalizeTranslationPanelWidth(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return TRANSLATION_PANEL_DEFAULT_WIDTH
  return Math.min(
    TRANSLATION_PANEL_MAX_WIDTH,
    Math.max(TRANSLATION_PANEL_MIN_WIDTH, Math.round(numeric)),
  )
}

export function resolveTranslationPanelLayout(
  containerWidth: number,
  preferredWidth: number,
): TranslationPanelLayout {
  const width = Math.max(0, Math.floor(containerWidth))
  const preferred = normalizeTranslationPanelWidth(preferredWidth)

  // Keep the first render stable until ResizeObserver reports the actual workspace width.
  if (width === 0) {
    return {
      mode: 'split',
      panelWidth: preferred,
      maximumPanelWidth: TRANSLATION_PANEL_MAX_WIDTH,
    }
  }

  if (width < TRANSLATION_SPLIT_MIN_WIDTH) {
    return { mode: 'replace', panelWidth: width, maximumPanelWidth: width }
  }

  const maximumPanelWidth = Math.max(
    TRANSLATION_PANEL_MIN_WIDTH,
    Math.min(
      TRANSLATION_PANEL_MAX_WIDTH,
      width - TRANSLATION_WEB_MIN_WIDTH - TRANSLATION_SPLITTER_WIDTH,
    ),
  )
  return {
    mode: 'split',
    panelWidth: Math.min(preferred, maximumPanelWidth),
    maximumPanelWidth,
  }
}
