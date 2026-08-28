import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeTranslationSettingsDraft } from './translationSettingsDraft.ts'
import type { TranslationSettings } from '@/types/settings'

function settings(): TranslationSettings {
  return {
    version: 1,
    provider: 'ai',
    sourceLanguage: 'auto',
    targetLanguage: 'zh',
    siteLanguage: 'en',
    confirmNonTargetSend: true,
    autoTranslateSelection: false,
    ai: { baseUrl: 'https://ai.old', apiKey: 'old', model: 'm1', effort: 'medium' },
    api: { baseUrl: 'https://api.old', apiKey: 'api-old' },
    offline: { baseUrl: 'http://127.0.0.1:5000' },
  }
}

test('settings draft keeps unrelated values that changed after the form opened', () => {
  const baseline = settings()
  const latest = {
    ...baseline,
    targetLanguage: 'ja',
    api: { ...baseline.api, apiKey: 'api-new' },
  }
  const draft = {
    ...baseline,
    provider: 'api' as const,
    ai: { ...baseline.ai, model: 'm2' },
  }

  assert.deepEqual(mergeTranslationSettingsDraft(latest, baseline, draft), {
    ...latest,
    provider: 'api',
    ai: { ...latest.ai, model: 'm2' },
  })
})

test('switching providers in a draft does not discard provider-specific edits', () => {
  const baseline = settings()
  const draft = {
    ...baseline,
    provider: 'offline' as const,
    autoTranslateSelection: true,
    ai: { ...baseline.ai, apiKey: 'edited-ai-key' },
    api: { ...baseline.api, baseUrl: 'http://translate.example.test' },
  }

  const merged = mergeTranslationSettingsDraft(baseline, baseline, draft)
  assert.equal(merged.provider, 'offline')
  assert.equal(merged.autoTranslateSelection, true)
  assert.equal(merged.ai.apiKey, 'edited-ai-key')
  assert.equal(merged.api.baseUrl, 'http://translate.example.test')
})
