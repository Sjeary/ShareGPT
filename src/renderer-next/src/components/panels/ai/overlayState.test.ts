import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { describeNoAiRoutesGuidance, resolveAiOverlay } from './overlayState.ts'

describe('resolveAiOverlay', () => {
  const baseArgs = {
    networkReady: false,
    senderRunning: false,
    advancedMode: true,
    hasEnvironment: false,
    hasRoute: false,
    availableRoutesCount: 1,
    routeLabel: '未选择环境',
    hasTab: false,
    initialized: false,
    proxyHost: '127.0.0.1',
    proxyPort: '10808',
  }

  it('always resolves no-environment first regardless of whether sender is running', () => {
    const stopped = resolveAiOverlay('gpt', { ...baseArgs, senderRunning: false })
    const running = resolveAiOverlay('gpt', { ...baseArgs, senderRunning: true })
    assert.equal(stopped?.reason, 'no-environment')
    assert.equal(running?.reason, 'no-environment')
    assert.equal(stopped?.title, '新建 ChatGPT 环境')
    assert.equal(running?.title, '新建 ChatGPT 环境')
  })

  it('explains missing routes when no environment and zero routes exist', () => {
    const state = resolveAiOverlay('claude', {
      ...baseArgs,
      availableRoutesCount: 0,
    })
    assert.equal(state?.reason, 'no-environment')
    assert.match(state?.text || '', /尚无可用线路/)
  })

  it('distinguishes proxy-stopped from route-inactive when environment and route exist', () => {
    const stopped = resolveAiOverlay('gpt', {
      ...baseArgs,
      hasEnvironment: true,
      hasRoute: true,
      senderRunning: false,
      routeLabel: '内置统一代理',
    })
    const inactive = resolveAiOverlay('gpt', {
      ...baseArgs,
      hasEnvironment: true,
      hasRoute: true,
      senderRunning: true,
      routeLabel: '内置统一代理',
    })
    assert.equal(stopped?.reason, 'proxy-stopped')
    assert.equal(inactive?.reason, 'route-inactive')
  })

  it('returns null once ready and initialized', () => {
    const ready = resolveAiOverlay('gpt', {
      ...baseArgs,
      networkReady: true,
      senderRunning: true,
      hasEnvironment: true,
      hasRoute: true,
      hasTab: true,
      initialized: true,
    })
    assert.equal(ready, null)
  })
})

describe('describeNoAiRoutesGuidance', () => {
  it('explains authorization gap for admin and member when authorized_proxy_route_ids is empty', () => {
    const admin = describeNoAiRoutesGuidance({ authorized_proxy_route_ids: [] }, true)
    const member = describeNoAiRoutesGuidance({ authorized_proxy_route_ids: [] }, false)
    assert.match(admin.title, /已授权/)
    assert.match(admin.reason, /不允许直连/)
    assert.equal(admin.canOpenAdmin, true)
    assert.match(admin.nextStep, /管理后台/)
    assert.equal(member.canOpenAdmin, false)
    assert.match(member.nextStep, /管理员/)
  })

  it('explains unconfigured routes when no routes are configured yet', () => {
    const admin = describeNoAiRoutesGuidance({}, true)
    assert.match(admin.title, /尚未配置/)
    assert.match(admin.reason, /不允许直连/)
    assert.equal(admin.canOpenAdmin, true)
  })
})
