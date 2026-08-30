import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PROXY_AUTHORIZATION_UNAVAILABLE,
  hasAuthoritativeProxyBootstrap,
  hasLegacyAdminProxyBootstrap,
  invalidateProxyAuthorization,
  isAcceptedProxyBootstrap,
  proxyAuthorizationInvalidationPatch,
  runAuthoritativeBootstrapRefresh,
} from './collabBootstrapAuthorization.ts'

test('旧服务器的 additive bootstrap 保持兼容，新服务器显式降级时 fail closed', () => {
  assert.equal(hasAuthoritativeProxyBootstrap({ proxyRoutes: [] }), true)
  assert.equal(
    hasAuthoritativeProxyBootstrap({
      proxyRoutes: [],
      capabilities: { proxyRoutes: { available: true, authoritative: true } },
    }),
    true,
  )
  assert.equal(
    hasAuthoritativeProxyBootstrap({
      proxyRoutes: [],
      capabilities: { proxyRoutes: { available: false, authoritative: false } },
    }),
    false,
  )
  assert.equal(hasAuthoritativeProxyBootstrap({}), false)
})

test('旧服务器 sender/airport 仅对已确认管理员构成兼容授权', () => {
  const legacy = {
    sender: { proxy_server: 'proxy.example', proxy_port: '443', proxy_uuid: 'uuid' },
    airport: { outbound: { type: 'socks', server: 'airport.example', server_port: 1080 } },
  }
  assert.equal(hasLegacyAdminProxyBootstrap(legacy), true)
  assert.equal(isAcceptedProxyBootstrap(legacy), false)
  assert.equal(isAcceptedProxyBootstrap(legacy, { allowLegacyAdminConfig: true }), true)
  assert.equal(
    isAcceptedProxyBootstrap(
      {
        ...legacy,
        proxyRoutes: [],
        capabilities: { proxyRoutes: { available: false, authoritative: false } },
      },
      { allowLegacyAdminConfig: true },
    ),
    false,
    '现代服务器显式不可用时不得借旧字段恢复授权',
  )
})

test('刷新先失效旧授权，非权威响应不得应用或公开', async () => {
  const events: string[] = []
  await assert.rejects(
    runAuthoritativeBootstrapRefresh({
      invalidate: async () => {
        events.push('invalidate')
      },
      fetchBootstrap: async () => {
        events.push('fetch')
        return {
          proxyRoutes: [],
          capabilities: { proxyRoutes: { available: false, authoritative: false } },
        }
      },
      applyBootstrap: async () => {
        events.push('apply')
        return null
      },
    }),
    new RegExp(PROXY_AUTHORIZATION_UNAVAILABLE),
  )
  assert.deepEqual(events, ['invalidate', 'fetch'])
})

test('失效只撤下授权证明，不删除缓存线路或用户环境设置', () => {
  assert.deepEqual(proxyAuthorizationInvalidationPatch(), {
    authorized_proxy_route_ids: [],
  })
})

test('只有权威响应完整应用后刷新事务才成功', async () => {
  const events: string[] = []
  const result = await runAuthoritativeBootstrapRefresh({
    invalidate: async () => {
      events.push('invalidate')
    },
    fetchBootstrap: async () => {
      events.push('fetch')
      return { proxyRoutes: [{ id: 'route-us' }] }
    },
    applyBootstrap: async () => {
      events.push('apply')
      return 'ready'
    },
  })
  assert.equal(result, 'ready')
  assert.deepEqual(events, ['invalidate', 'fetch', 'apply'])
})

test('bootstrap 返回期间 Principal 变化时不得应用旧账号线路', async () => {
  const events: string[] = []
  let current = true
  await assert.rejects(
    runAuthoritativeBootstrapRefresh({
      assertCurrent: () => {
        events.push('assert')
        if (!current) throw new Error('stale principal')
      },
      invalidate: async () => {
        events.push('invalidate')
      },
      fetchBootstrap: async () => {
        events.push('fetch')
        current = false
        return { proxyRoutes: [{ id: 'route-a' }] }
      },
      applyBootstrap: async () => {
        events.push('apply')
        return null
      },
    }),
    /stale principal/,
  )
  assert.equal(events.includes('apply'), false)
})

test('撤权先清内存和持久设置，stopSender 失败不阻断', async () => {
  const events: string[] = []
  await invalidateProxyAuthorization({
    clearMemory: () => events.push('memory'),
    persistClearedAuthorization: async () => {
      events.push('persist')
    },
    stopSender: async () => {
      events.push('stop')
      throw new Error('receiver mode')
    },
  })
  assert.deepEqual(events, ['memory', 'persist', 'stop'])
})

test('持久撤权失败仍停止 sender，并把持久化错误交给上层降级', async () => {
  const events: string[] = []
  await assert.rejects(
    invalidateProxyAuthorization({
      clearMemory: () => events.push('memory'),
      persistClearedAuthorization: async () => {
        events.push('persist')
        throw new Error('disk unavailable')
      },
      stopSender: async () => {
        events.push('stop')
      },
    }),
    /disk unavailable/,
  )
  assert.deepEqual(events, ['memory', 'persist', 'stop'])
})
