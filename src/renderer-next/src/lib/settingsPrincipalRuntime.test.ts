import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyPrincipalOperation,
  createSettingsPrincipalRuntime,
  persistPrincipalSettings,
} from './settingsPrincipalRuntime.ts'

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason?: unknown) => void = () => undefined
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, reject, resolve }
}

const conflict = new Error('设置已被其他操作更新，请重试')
const isConflict = (error: unknown) => String(error).includes('设置已被其他操作更新')

test('renderer Principal generation can be synchronized with the main process', () => {
  const runtime = createSettingsPrincipalRuntime()
  assert.deepEqual(runtime.activate('principal-a', 7), {
    principalId: 'principal-a',
    generation: 7,
  })
  const old = runtime.snapshot()
  runtime.activate('principal-b', 8)
  runtime.activate('principal-a', 9)
  assert.throws(() => runtime.assertCurrent(old), /账号已切换/)
})

test('a pending A write cannot apply its late success after activating B', async () => {
  const runtime = createSettingsPrincipalRuntime()
  const snapshot = runtime.activate('principal-a')
  const pending = deferred<{ settingsRevision: number; owner: string }>()
  const applied: string[] = []
  const write = persistPrincipalSettings({
    runtime,
    snapshot,
    current: { settingsRevision: 1, owner: 'A' },
    write: () => pending.promise,
    loadLatest: async () => ({ settingsRevision: 1, owner: 'A' }),
    apply: (settings) => applied.push(settings.owner),
    isRevisionConflict: isConflict,
  })

  runtime.activate('principal-b')
  pending.resolve({ settingsRevision: 2, owner: 'A saved' })
  await assert.rejects(write, /账号已切换/)
  assert.deepEqual(applied, [])
})

test('a pending A reload cannot apply its late result after activating B', async () => {
  const runtime = createSettingsPrincipalRuntime()
  const snapshot = runtime.activate('principal-a')
  const pending = deferred<{ settingsRevision: number; owner: string }>()
  const applied: string[] = []
  const reload = applyPrincipalOperation({
    runtime,
    snapshot,
    operation: () => pending.promise,
    apply: (settings) => applied.push(settings.owner),
  })

  runtime.activate('principal-b')
  pending.resolve({ settingsRevision: 2, owner: 'A loaded' })
  await assert.rejects(reload, /账号已切换/)
  assert.deepEqual(applied, [])
})

test('an A conflict that loads across a B switch never retries', async () => {
  const runtime = createSettingsPrincipalRuntime()
  const snapshot = runtime.activate('principal-a')
  const loadStarted = deferred<void>()
  const latest = deferred<{ settingsRevision: number; owner: string }>()
  const writes: Array<[number | undefined, string]> = []
  const operation = persistPrincipalSettings({
    runtime,
    snapshot,
    current: { settingsRevision: 1, owner: 'A' },
    write: async (revision, principalId) => {
      writes.push([revision, principalId])
      throw conflict
    },
    loadLatest: () => {
      loadStarted.resolve()
      return latest.promise
    },
    apply: () => assert.fail('stale settings must not be applied'),
    isRevisionConflict: isConflict,
  })

  await loadStarted.promise
  runtime.activate('principal-b')
  latest.resolve({ settingsRevision: 7, owner: 'B' })
  await assert.rejects(operation, /账号已切换/)
  assert.deepEqual(writes, [[1, 'principal-a']])
})

test('a same-principal conflict retries with the latest revision and principal', async () => {
  const runtime = createSettingsPrincipalRuntime()
  const snapshot = runtime.activate('principal-a')
  const writes: Array<[number | undefined, string]> = []
  const applied: string[] = []
  const saved = await persistPrincipalSettings({
    runtime,
    snapshot,
    current: { settingsRevision: 1, owner: 'A' },
    write: async (revision, principalId) => {
      writes.push([revision, principalId])
      if (writes.length === 1) throw conflict
      return { settingsRevision: 8, owner: 'A saved' }
    },
    loadLatest: async () => ({ settingsRevision: 7, owner: 'A latest' }),
    apply: (settings) => applied.push(settings.owner),
    isRevisionConflict: isConflict,
  })

  assert.equal(saved.settingsRevision, 8)
  assert.deepEqual(writes, [
    [1, 'principal-a'],
    [7, 'principal-a'],
  ])
  assert.deepEqual(applied, ['A saved'])
})

test('a stale non-conflict failure cannot roll A settings back over B', async () => {
  const runtime = createSettingsPrincipalRuntime()
  const snapshot = runtime.activate('principal-a')
  const pending = deferred<{ settingsRevision: number; owner: string }>()
  const applied: string[] = []
  const operation = persistPrincipalSettings({
    runtime,
    snapshot,
    current: { settingsRevision: 1, owner: 'A previous' },
    write: () => pending.promise,
    loadLatest: async () => ({ settingsRevision: 1, owner: 'A rollback' }),
    apply: (settings) => applied.push(settings.owner),
    isRevisionConflict: isConflict,
  })

  runtime.activate('principal-b')
  pending.reject(new Error('disk failed'))
  await assert.rejects(operation, /账号已切换/)
  assert.deepEqual(applied, [])
})
