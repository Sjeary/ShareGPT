import type { TranslationSettings } from '@/types/settings'

// Apply only fields edited in the open settings transaction. This keeps newer
// account-scoped values that may have arrived while the form was open.
export function mergeTranslationSettingsDraft(
  latest: TranslationSettings,
  baseline: TranslationSettings,
  draft: TranslationSettings,
): TranslationSettings {
  const pick = <T>(current: T, before: T, edited: T) =>
    Object.is(before, edited) ? current : edited

  return {
    ...latest,
    version: 1,
    provider: pick(latest.provider, baseline.provider, draft.provider),
    sourceLanguage: pick(latest.sourceLanguage, baseline.sourceLanguage, draft.sourceLanguage),
    targetLanguage: pick(latest.targetLanguage, baseline.targetLanguage, draft.targetLanguage),
    siteLanguage: pick(latest.siteLanguage, baseline.siteLanguage, draft.siteLanguage),
    confirmNonTargetSend: pick(
      latest.confirmNonTargetSend,
      baseline.confirmNonTargetSend,
      draft.confirmNonTargetSend,
    ),
    autoTranslateSelection: pick(
      latest.autoTranslateSelection,
      baseline.autoTranslateSelection,
      draft.autoTranslateSelection,
    ),
    ai: {
      baseUrl: pick(latest.ai.baseUrl, baseline.ai.baseUrl, draft.ai.baseUrl),
      apiKey: pick(latest.ai.apiKey, baseline.ai.apiKey, draft.ai.apiKey),
      model: pick(latest.ai.model, baseline.ai.model, draft.ai.model),
      effort: pick(latest.ai.effort, baseline.ai.effort, draft.ai.effort),
    },
    api: {
      baseUrl: pick(latest.api.baseUrl, baseline.api.baseUrl, draft.api.baseUrl),
      apiKey: pick(latest.api.apiKey, baseline.api.apiKey, draft.api.apiKey),
    },
    offline: {
      baseUrl: pick(latest.offline.baseUrl, baseline.offline.baseUrl, draft.offline.baseUrl),
    },
  }
}
