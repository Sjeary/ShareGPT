import assert from 'node:assert/strict'
import test from 'node:test'
import { availableAiRoutes } from './aiEnvironments.ts'

const completeSender = {
  proxy_server: 'proxy.example.com',
  proxy_port: '443',
  proxy_uuid: 'route-credential',
  airport_name: 'Legacy airport',
  airport_outbound: { type: 'socks', server: 'airport.example.com', server_port: 1080 },
  managed_proxy_routes: [
    { id: 'route-us', name: 'US', enabled: true, outbound: { type: 'socks' } },
    {
      id: 'route-disabled',
      name: 'Disabled',
      enabled: false,
      outbound: { type: 'socks' },
    },
    { id: '../invalid', name: 'Invalid', enabled: true, outbound: { type: 'socks' } },
  ],
}

test('an explicit empty authorization exposes no cached or legacy routes', () => {
  assert.deepEqual(availableAiRoutes({ ...completeSender, authorized_proxy_route_ids: [] }), [])
})

test('an explicit authorization exposes only the allowed route subset', () => {
  assert.deepEqual(
    availableAiRoutes({
      ...completeSender,
      authorized_proxy_route_ids: ['route-us', 'internal-airport'],
    }).map((route) => route.id),
    ['route-us', 'internal-airport'],
  )
})

test('legacy settings without an authorization field retain valid enabled routes only', () => {
  assert.deepEqual(
    availableAiRoutes(completeSender).map((route) => route.id),
    ['internal-unified', 'route-us', 'internal-airport'],
  )
})
