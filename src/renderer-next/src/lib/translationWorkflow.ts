export type ComposerOutputFormat = 'translated' | 'bilingual'

export interface ComposerTranslationSnapshot {
  translation: string
  preview: string
  previewEdited: boolean
  phase: 'ready' | 'stale'
}

export function stoppedComposerState(snapshot: ComposerTranslationSnapshot | null) {
  if (!snapshot) {
    return {
      translation: '',
      preview: '',
      previewEdited: false,
      phase: 'stopped' as const,
      status: '已停止；未完成内容不会写入网页',
    }
  }
  return {
    ...snapshot,
    status:
      snapshot.phase === 'stale'
        ? '已停止；保留的上一次发送预览已经过期'
        : '已停止；已保留上一次完整发送预览',
  }
}

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
