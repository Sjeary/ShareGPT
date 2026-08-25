import assert from 'node:assert/strict'
import test from 'node:test'

import { availableAiRoutes, normalizeAdvancedAiSettings } from './aiEnvironments.ts'

const outbound = { type: 'socks', server: 'proxy.example', server_port: 1080 }

test('availableAiRoutes only returns valid, enabled and authorized routes', () => {
  const routes = availableAiRoutes({
    managed_proxy_routes: [
      { id: 'allowed', name: 'Allowed', enabled: true, outbound },
      { id: 'disabled', name: 'Disabled', enabled: false, outbound },
      { id: 'unauthorized', name: 'Unauthorized', enabled: true, outbound },
      { id: 'invalid id', name: 'Invalid', enabled: true, outbound },
    ],
    authorized_proxy_route_ids: ['allowed', 'disabled', 'invalid id'],
  })

  assert.deepEqual(
    routes.map((route) => route.id),
    ['allowed'],
  )
})

test('availableAiRoutes fails closed when authorization is missing or empty', () => {
  const sender = {
    managed_proxy_routes: [{ id: 'managed', name: 'Managed', enabled: true, outbound }],
  }
  assert.deepEqual(availableAiRoutes(sender), [])
  assert.deepEqual(availableAiRoutes({ ...sender, authorized_proxy_route_ids: [] }), [])
})

test('availableAiRoutes deduplicates unified, managed and legacy route IDs', () => {
  const routes = availableAiRoutes({
    proxy_server: 'proxy.example',
    proxy_port: '443',
    proxy_uuid: 'uuid',
    managed_proxy_routes: [
      { id: 'internal-unified', name: 'Duplicate unified', enabled: true, outbound },
      { id: 'internal-airport', name: 'Managed airport', enabled: true, outbound },
    ],
    airport_outbound: outbound,
    airport_name: 'Legacy airport',
    authorized_proxy_route_ids: ['internal-unified', 'internal-airport'],
  })

  assert.deepEqual(
    routes.map((route) => route.id),
    ['internal-unified', 'internal-airport'],
  )
})

test('normalizeAdvancedAiSettings removes duplicate environment partitions', () => {
  const settings = normalizeAdvancedAiSettings({
    enabled: true,
    environments: [
      { id: 'env-one', kind: 'gpt', name: 'First', routeId: 'route-a' },
      { id: 'env-one', kind: 'gpt', name: 'Duplicate', routeId: 'route-b' },
      { id: 'env-one', kind: 'claude', name: 'Other service', routeId: 'route-c' },
    ],
    activeByKind: { gpt: 'env-one' },
  })

  assert.equal(settings.environments.length, 2)
  assert.equal(settings.environments[0].name, 'Duplicate')
  assert.equal(settings.activeByKind.gpt, 'env-one')
})
