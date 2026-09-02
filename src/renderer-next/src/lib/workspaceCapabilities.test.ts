import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canStartWorkspaceProxy,
  workspaceModuleAvailable,
  workspaceNavAvailable,
} from './workspaceCapabilities.ts'

test('personal workspace exposes local modules and hides organization modules', () => {
  assert.equal(workspaceNavAvailable('personal', 'service'), true)
  assert.equal(workspaceNavAvailable('personal', 'gpt'), true)
  assert.equal(workspaceNavAvailable('personal', 'notes'), true)
  assert.equal(workspaceNavAvailable('personal', 'chat'), false)
  assert.equal(workspaceNavAvailable('personal', 'team'), false)
  assert.equal(workspaceNavAvailable('personal', 'stats'), false)
})

test('organization workspace applies collaboration capability without disabling local modules', () => {
  assert.equal(workspaceNavAvailable('organization', 'chat'), true)
  assert.equal(workspaceNavAvailable('organization', 'chat', { chatDisabled: true }), false)
  assert.equal(workspaceModuleAvailable('organization', 'embedded-ai'), true)
  assert.equal(workspaceModuleAvailable('organization', 'personal-organizer'), true)
})

test('personal proxy does not depend on collaboration presence', () => {
  assert.equal(canStartWorkspaceProxy('personal', false), true)
  assert.equal(canStartWorkspaceProxy('organization', false), false)
  assert.equal(canStartWorkspaceProxy('organization', true), true)
  assert.equal(canStartWorkspaceProxy('chooser', true), false)
})
