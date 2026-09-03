import test from 'node:test'
import assert from 'node:assert/strict'
import { canEditManagedProxy, shouldApplyManagedProxy } from './managedProxyPolicy.ts'

const configured = {
  proxy_server: 'proxy.example.com',
  proxy_port: '443',
  proxy_uuid: 'managed-id',
}

test('只有管理员和高级用户可以编辑团队代理配置', () => {
  assert.equal(canEditManagedProxy(null), false)
  assert.equal(canEditManagedProxy({}), false)
  assert.equal(canEditManagedProxy({ isAdmin: true }), true)
  assert.equal(canEditManagedProxy({ advancedAiAllowed: true }), true)
})

test('普通成员始终接受完整的管理员配置更新', () => {
  assert.equal(
    shouldApplyManagedProxy(
      { proxy_server: 'old.example.com', proxy_port: '8443', proxy_uuid: 'old-id' },
      configured,
      false,
    ),
    true,
  )
})

test('管理员和高级用户只在本机配置不完整时补全', () => {
  assert.equal(shouldApplyManagedProxy(configured, configured, true), false)
  assert.equal(shouldApplyManagedProxy({ proxy_server: '' }, configured, true), true)
  assert.equal(shouldApplyManagedProxy(configured, { proxy_server: '' }, false), false)
})
