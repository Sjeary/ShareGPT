import assert from 'node:assert/strict'
import test from 'node:test'
import {
  currentAiEnvironmentOperation,
  isCurrentAiEnvironmentOperation,
  startAiEnvironmentOperation,
} from './aiEnvironmentRuntime.ts'

test('AI environment runtime invalidates an older operation after a switch', () => {
  const first = startAiEnvironmentOperation('gpt', 'environment-a')
  assert.equal(isCurrentAiEnvironmentOperation(first), true)

  const second = startAiEnvironmentOperation('gpt', 'environment-b')
  assert.equal(second.generation, first.generation + 1)
  assert.equal(isCurrentAiEnvironmentOperation(first), false)
  assert.equal(isCurrentAiEnvironmentOperation(second), true)
  assert.deepEqual(currentAiEnvironmentOperation('gpt'), second)
})

test('AI environment runtime keeps generations independent by kind', () => {
  const gpt = startAiEnvironmentOperation('gpt', 'gpt-a')
  const claude = startAiEnvironmentOperation('claude', 'claude-a')

  assert.equal(isCurrentAiEnvironmentOperation(gpt), true)
  assert.equal(isCurrentAiEnvironmentOperation(claude), true)
})
