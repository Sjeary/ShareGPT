import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isGptAuthUrl } from './constants.ts'

describe('isGptAuthUrl', () => {
  it('matches ChatGPT and OpenAI authentication pages', () => {
    assert.equal(isGptAuthUrl('https://chatgpt.com/auth/login'), true)
    assert.equal(isGptAuthUrl('https://chatgpt.com/auth/login_next'), true)
    assert.equal(isGptAuthUrl('https://auth.openai.com/log-in'), true)
    assert.equal(isGptAuthUrl('https://auth0.openai.com/u/login'), false)
    assert.equal(isGptAuthUrl('https://openai.auth0.com/u/login'), true)
  })

  it('does not match logged-in ChatGPT conversation pages or invalid URLs', () => {
    assert.equal(isGptAuthUrl('https://chatgpt.com/'), false)
    assert.equal(isGptAuthUrl('https://chatgpt.com/c/12345'), false)
    assert.equal(isGptAuthUrl('https://claude.ai/'), false)
    assert.equal(isGptAuthUrl(''), false)
  })
})
