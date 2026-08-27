import assert from 'node:assert/strict'
import test from 'node:test'

import { authorizedAirportRoute, runtimeSenderForPrincipal } from './runtimeSender.ts'
import { useAuthStore } from '../store/useAuthStore.ts'

test('runtime sender applies only to its exact principal without mutating local settings', () => {
  const local = {
    proxy_server: 'stale.example',
    proxy_port: '1',
    proxy_uuid: 'stale-secret',
    socks_listen_port: '1080',
    fallback_mode: 'direct',
    fallback_local_port: '',
    target_domains: 'chatgpt.com',
  }
  const runtime = {
    principalId: 'principal-a',
    sender: {
      proxy_server: 'current.example',
      proxy_port: '443',
      proxy_uuid: 'runtime-only-secret',
      socks_listen_port: '2080',
    },
  }

  const current = runtimeSenderForPrincipal(local, runtime, 'principal-a')
  assert.equal(current.serverManaged, true)
  assert.equal(current.settings.proxy_server, 'current.example')
  assert.equal(current.settings.proxy_uuid, 'runtime-only-secret')
  assert.equal(current.settings.socks_listen_port, '2080')
  assert.equal(local.proxy_uuid, 'stale-secret')

  const other = runtimeSenderForPrincipal(local, runtime, 'principal-b')
  assert.equal(other.serverManaged, false)
  assert.equal(other.settings.proxy_server, 'stale.example')
  assert.equal(other.settings.proxy_uuid, 'stale-secret')
})

test('an empty authoritative sender clears stale local credentials from the effective form', () => {
  const result = runtimeSenderForPrincipal(
    {
      proxy_server: 'stale.example',
      proxy_port: '443',
      proxy_uuid: 'stale-secret',
      socks_listen_port: '',
      fallback_mode: 'system_proxy',
      fallback_local_port: '',
      target_domains: '',
    },
    { principalId: 'principal-a', sender: {} },
    'principal-a',
  )
  assert.equal(result.serverManaged, true)
  assert.equal(result.settings.proxy_server, '')
  assert.equal(result.settings.proxy_port, '')
  assert.equal(result.settings.proxy_uuid, '')
})

test('clearing the auth session removes runtime sender credentials', () => {
  const auth = useAuthStore.getState()
  auth.setRuntimeSender({
    principalId: 'principal-a',
    sender: { proxy_server: 'current.example', proxy_uuid: 'runtime-only-secret' },
  })
  assert.equal(useAuthStore.getState().runtimeSender?.sender.proxy_uuid, 'runtime-only-secret')
  useAuthStore.getState().clearSession()
  assert.equal(useAuthStore.getState().runtimeSender, null)
})

test('airport availability requires a verified runtime authorization descriptor', () => {
  const routes = [
    { id: 'internal-airport', name: 'JP managed', mode: 'singbox' as const, configKey: 'jp-1' },
  ]
  assert.equal(authorizedAirportRoute(false, routes), null)
  assert.equal(authorizedAirportRoute(true, []), null)
  assert.deepEqual(authorizedAirportRoute(true, routes), routes[0])
})
