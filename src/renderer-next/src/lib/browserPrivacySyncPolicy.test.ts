import test from 'node:test'
import assert from 'node:assert/strict'
import { browserPrivacySyncPayload, mergeBrowserPrivacySync } from './browserPrivacySyncPolicy.ts'
import type { BrowserPrivacySettings } from '../types/settings.ts'

function fixture(): BrowserPrivacySettings {
  return {
    version: 1,
    syncEnabled: true,
    updatedAt: '2026-07-10T10:00:00.000Z',
    environment: {
      mode: 'proxy',
      locale: 'en-US',
      acceptLanguages: 'en-US,en',
      timezone: 'America/New_York',
      geolocationMode: 'proxy',
      autoSyncFromProxy: true,
      sourceIp: '203.0.113.9',
      countryCode: 'US',
      country: 'United States',
      region: 'NY',
      city: 'New York',
      latitude: 40.7,
      longitude: -74,
      accuracy: 20,
      sourceUpdatedAt: '2026-07-10T09:30:00.000Z',
    },
    fingerprint: {
      enabled: false,
      preset: 'balanced',
      hardwareConcurrency: 8,
      deviceMemory: 8,
      screenWidth: 1920,
      screenHeight: 1080,
      availableHeight: 1040,
      devicePixelRatio: 1,
      colorDepth: 24,
      maxTouchPoints: 0,
      canvasNoise: true,
      audioNoise: true,
      mediaDevices: 'preserve',
    },
    lastClearedAt: { gpt: '', gemini: '', claude: '2026-07-10T09:00:00.000Z' },
    localProfiles: {
      gpt: { id: 'gpt-local', rebuiltAt: '' },
      gemini: { id: 'gemini-local', rebuiltAt: '' },
      claude: { id: 'claude-local', rebuiltAt: '' },
    },
    audit: {
      current: { gpt: { local: true }, gemini: null, claude: null },
      beforeClear: { gpt: null, gemini: null, claude: null },
    },
  }
}

test('runtime sync payload excludes all device detection, audit, clearing and profile data', () => {
  const payload = browserPrivacySyncPayload(fixture())
  for (const field of [
    'sourceIp',
    'sourceUpdatedAt',
    'timezone',
    'latitude',
    'longitude',
    'country',
  ])
    assert.equal(Object.hasOwn(payload.environment, field), false, field)
  for (const field of ['lastClearedAt', 'localProfiles', 'audit'])
    assert.equal(Object.hasOwn(payload, field), false, field)
  assert.equal(payload.fingerprint?.enabled, false)
})

test('proxy-to-proxy merges retain local detection and reject remote location values', () => {
  const local = fixture()
  const payload = browserPrivacySyncPayload(local)
  const remote = {
    ...payload,
    updatedAt: '2026-07-11T10:00:00.000Z',
    environment: {
      ...payload.environment,
      timezone: 'America/Chicago',
      sourceIp: '198.51.100.2',
      latitude: 1,
      longitude: 2,
      sourceUpdatedAt: '2099-01-01T00:00:00.000Z',
    },
  }
  const merged = mergeBrowserPrivacySync(local, remote)
  assert.equal(merged.environment.sourceIp, '203.0.113.9')
  assert.equal(merged.environment.latitude, 40.7)
  assert.equal(merged.environment.longitude, -74)
  assert.equal(merged.environment.timezone, 'America/New_York')
  assert.deepEqual(merged.lastClearedAt, local.lastClearedAt)
  assert.deepEqual(merged.localProfiles, local.localProfiles)
  assert.deepEqual(merged.audit, local.audit)
})

for (const mode of ['system', 'us', 'proxy'] as const)
  test(`changing environment to ${mode} invalidates incompatible device detection`, () => {
    const local = fixture()
    if (mode === 'proxy') local.environment.mode = 'system'
    const payload = browserPrivacySyncPayload(local)
    const merged = mergeBrowserPrivacySync(local, {
      ...payload,
      updatedAt: '2026-07-11T10:00:00.000Z',
      environment: { ...payload.environment, mode, timezone: 'America/Chicago' },
    })
    assert.equal(merged.environment.sourceIp, '')
    assert.equal(merged.environment.sourceUpdatedAt, '')
    assert.equal(merged.environment.latitude, null)
    assert.equal(merged.environment.longitude, null)
    assert.equal(
      merged.environment.timezone,
      mode === 'proxy' ? local.environment.timezone : 'America/Chicago',
    )
    assert.deepEqual(merged.localProfiles, local.localProfiles)
  })

test('older or equal remote settings never replace local preferences', () => {
  const local = fixture()
  assert.equal(mergeBrowserPrivacySync(local, browserPrivacySyncPayload(local)), local)
})
