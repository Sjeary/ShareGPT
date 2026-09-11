import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOnboardingSteps } from './onboardingSteps.ts'

test('onboarding points optional modules to account settings without opening them', () => {
  const steps = buildOnboardingSteps('ShareGPT')
  assert.deepEqual(
    steps.map((step) => step.target),
    [undefined, 'nav-service', 'nav-chat', 'nav-gpt', 'nav-stats', 'nav-account', undefined],
  )
  const discovery = steps.find((step) => step.target === 'nav-account')
  assert.equal(discovery?.title, '更多功能可以在这里发掘')
  assert.match(discovery?.body ?? '', /账户 → 界面设置/)
  assert.match(discovery?.body ?? '', /不会替你开启/)
})
