import assert from 'node:assert/strict'
import test from 'node:test'
import type { AdvancedAiSettings, TranslationSettings } from '../types/settings.ts'
import { principalSectionOperations } from '../lib/settingsOperations.ts'

test('settings operations use stable environment paths instead of replacing advancedAi', () => {
  const current: AdvancedAiSettings = {
    version: 1,
    enabled: true,
    environments: [
      { id: 'environment-a', kind: 'gpt', name: 'A', routeId: 'route-a' },
      { id: 'environment-b', kind: 'gpt', name: 'B', routeId: 'route-b' },
    ],
    activeByKind: { gpt: 'environment-a', gemini: '', claude: '' },
  }
  const next: AdvancedAiSettings = {
    ...current,
    environments: [{ ...current.environments[0], name: 'A renamed' }, current.environments[1]],
    activeByKind: { ...current.activeByKind, gpt: 'environment-b' },
  }

  assert.deepEqual(principalSectionOperations('advancedAi', current, next), [
    { op: 'set', path: ['activeByKind', 'gpt'], value: 'environment-b' },
    {
      op: 'set',
      path: ['environments', 'environment-a', 'name'],
      value: 'A renamed',
    },
  ])
})

test('settings operations emit only changed nested translation fields', () => {
  const current = {
    version: 1,
    provider: 'api',
    sourceLanguage: 'auto',
    targetLanguage: 'zh-CN',
    siteLanguage: 'en',
    confirmNonTargetSend: true,
    autoTranslateSelection: false,
    ai: { baseUrl: '', apiKey: '', model: '', effort: 'medium' },
    api: { baseUrl: 'https://translate.example/v1', apiKey: 'old' },
    offline: { baseUrl: '' },
  } as TranslationSettings
  const next = {
    ...current,
    api: { ...current.api, apiKey: 'new' },
  }

  assert.deepEqual(principalSectionOperations('translation', current, next), [
    { op: 'set', path: ['api', 'apiKey'], value: 'new' },
  ])
})

test('translation behavior fields are persisted as independent principal operations', () => {
  const current: TranslationSettings = {
    version: 1,
    provider: 'ai',
    sourceLanguage: 'auto',
    targetLanguage: 'zh',
    siteLanguage: 'en',
    confirmNonTargetSend: true,
    autoTranslateSelection: false,
    ai: { baseUrl: '', apiKey: '', model: 'gpt-5.5', effort: 'medium' },
    api: { baseUrl: '', apiKey: '' },
    offline: { baseUrl: 'http://127.0.0.1:5000' },
  }

  assert.deepEqual(
    principalSectionOperations('translation', current, {
      ...current,
      siteLanguage: 'ja',
      confirmNonTargetSend: false,
      autoTranslateSelection: true,
    }),
    [
      { op: 'set', path: ['siteLanguage'], value: 'ja' },
      { op: 'set', path: ['confirmNonTargetSend'], value: false },
      { op: 'set', path: ['autoTranslateSelection'], value: true },
    ],
  )
})
