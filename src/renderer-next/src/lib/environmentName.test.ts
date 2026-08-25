import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeEnvironmentNameDraft } from './environmentName.ts'

test('environment name draft trims input and rolls empty names back', () => {
  assert.equal(normalizeEnvironmentNameDraft('  Team account  ', 'Existing'), 'Team account')
  assert.equal(normalizeEnvironmentNameDraft('   ', 'Existing'), 'Existing')
})

test('environment name draft is limited to the persisted maximum length', () => {
  assert.equal(normalizeEnvironmentNameDraft('a'.repeat(80), 'Existing').length, 60)
})
