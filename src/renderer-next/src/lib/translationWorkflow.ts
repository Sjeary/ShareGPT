export type ComposerOutputFormat = 'translated' | 'bilingual'

export function buildComposerPreview(
  sourceText: string,
  translatedText: string,
  format: ComposerOutputFormat,
): string {
  const source = sourceText.trim()
  const translation = translatedText.trim()
  if (!translation) return ''
  if (format === 'translated' || !source) return translation
  return `原文：\n${source}\n\n译文：\n${translation}`
}
