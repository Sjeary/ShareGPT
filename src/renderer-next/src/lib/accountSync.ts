import {
  settingsPrincipalRuntime,
  StaleSettingsPrincipalError,
  type SettingsPrincipalSnapshot,
} from '@/lib/settingsPrincipalRuntime'
import { userDataTransitionState } from '@/lib/userDataTransitionState'
import { wsBus } from '@/lib/wsBus'

export type AccountSyncState = 'off' | 'local' | 'syncing' | 'synced' | 'error'

export interface AccountScope {
  readonly snapshot: SettingsPrincipalSnapshot
  readonly signal: AbortSignal
  isCurrent: () => boolean
  assertCurrent: () => void
  close: () => void
}

// Ownership is captured before asynchronous work, including work that has not reached IPC yet.
export function createAccountScope(isActive: () => boolean = () => true): AccountScope {
  const snapshot = { ...settingsPrincipalRuntime.current() }
  const transition = userDataTransitionState.revision()
  const controller = new AbortController()
  let closed = false
  let unsubscribe: (() => void) | undefined
  const isCurrent = () => {
    const current = settingsPrincipalRuntime.current()
    return (
      !closed &&
      Boolean(snapshot.principalId) &&
      !userDataTransitionState.isSuspended() &&
      userDataTransitionState.revision() === transition &&
      current.principalId === snapshot.principalId &&
      current.generation === snapshot.generation &&
      isActive()
    )
  }
  const close = () => {
    if (closed) return
    closed = true
    controller.abort()
    unsubscribe?.()
  }
  if (typeof userDataTransitionState.subscribe === 'function') {
    unsubscribe = userDataTransitionState.subscribe(() => {
      if (!isCurrent()) close()
    })
  }
  return {
    snapshot,
    signal: controller.signal,
    isCurrent,
    assertCurrent() {
      if (!isCurrent()) throw new StaleSettingsPrincipalError()
    },
    close,
  }
}

export interface SyncRecord<D> {
  rev: number
  data?: D | null
}

interface MergeContext {
  scope: AccountScope
  previousRevision: number
  initial: boolean
}

export interface AccountSyncOptions<D> {
  kind: string
  serverUrl: string
  token: string
  pollMs: number
  debounceMs: number
  isActive?: () => boolean
  isReady: () => boolean
  getLocal: () => D
  serialize?: (data: D | null | undefined) => string
  getRevision: (scope: AccountScope) => number
  setRevision: (revision: number, scope: AccountScope) => void
  mergeRemote: (remote: SyncRecord<D>, context: MergeContext) => void | Promise<void>
  acknowledge?: (sent: D, remote: SyncRecord<D>, scope: AccountScope) => void | Promise<void>
  subscribeLocal: (notify: () => void) => () => void
  setState?: (state: AccountSyncState) => void
}

class SyncHttpError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`同步请求失败（HTTP ${status}）`)
    this.status = status
  }
}

// One transport/lifecycle owner; adapters retain their existing merge and persistence semantics.
export function createAccountSync<D>(options: AccountSyncOptions<D>) {
  const scope = createAccountScope(options.isActive)
  const serialize = options.serialize ?? ((data) => JSON.stringify(data) ?? '')
  let revision = options.getRevision(scope)
  let confirmed = ''
  let initialized = false
  let unsupported = false
  let started = false
  let applying = false
  let chain: Promise<void> = Promise.resolve()
  let pushTimer: number | null = null
  let pollTimer: number | null = null
  const unsubs: Array<() => void> = []

  const state = (value: AccountSyncState) => {
    if (scope.isCurrent()) options.setState?.(value)
  }
  const remember = (remote: SyncRecord<D>) => {
    scope.assertCurrent()
    if (remote.rev < revision) throw new Error('同步版本早于已确认版本，已保留本机资料')
    options.setRevision(remote.rev, scope)
    revision = remote.rev
    confirmed = serialize(remote.data)
    initialized = true
  }

  async function request(method: 'GET' | 'PUT', data?: D) {
    scope.assertCurrent()
    const controller = new AbortController()
    const cancel = () => controller.abort()
    scope.signal.addEventListener('abort', cancel, { once: true })
    const timeout = window.setTimeout(cancel, 15000)
    try {
      const response = await fetch(
        `${options.serverUrl.replace(/\/+$/, '')}/api/user-store/${options.kind}`,
        {
          method,
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.token}` },
          ...(method === 'PUT' ? { body: JSON.stringify({ baseRev: revision, data }) } : {}),
        },
      )
      scope.assertCurrent()
      if (!response.ok && response.status !== 409) throw new SyncHttpError(response.status)
      const remote = (await response.json()) as SyncRecord<D>
      scope.assertCurrent()
      if (
        !remote ||
        !Number.isInteger(remote.rev) ||
        remote.rev < 0 ||
        ((method === 'GET' || response.status === 409) && !Object.hasOwn(remote, 'data'))
      ) {
        throw new Error('同步响应缺少有效版本或资料，已保留本机资料')
      }
      return { remote, conflict: response.status === 409 }
    } finally {
      window.clearTimeout(timeout)
      scope.signal.removeEventListener('abort', cancel)
    }
  }

  async function merge(remote: SyncRecord<D>, initial: boolean) {
    scope.assertCurrent()
    if (remote.rev < revision) throw new Error('同步版本早于已确认版本，已保留本机资料')
    await options.mergeRemote(remote, { scope, previousRevision: revision, initial })
    scope.assertCurrent()
    remember(remote)
  }

  async function push() {
    for (let attempt = 0; attempt < 3; attempt++) {
      scope.assertCurrent()
      const sent = structuredClone(options.getLocal())
      const baseRev = revision
      const { remote, conflict } = await request('PUT', sent)
      if (conflict) {
        await merge(remote, false)
        if (attempt === 2) throw new Error('同步资料持续变化，请稍后重试')
        continue
      }
      if (remote.rev <= baseRev) throw new Error('服务器未确认新的同步版本')
      await options.acknowledge?.(sent, remote, scope)
      scope.assertCurrent()
      remember({ rev: remote.rev, data: remote.data ?? sent })
      return
    }
  }

  function enqueue(work: () => Promise<void>): Promise<void> {
    chain = chain.then(async () => {
      if (!scope.isCurrent() || unsupported) return
      if (!options.isReady()) {
        state('error')
        return
      }
      applying = true
      state('syncing')
      try {
        await work()
        scope.assertCurrent()
        if (serialize(options.getLocal()) === confirmed) state('synced')
        else {
          state('syncing')
          schedulePush()
        }
      } catch (error) {
        if (!scope.isCurrent()) return
        unsupported = error instanceof SyncHttpError && [404, 405, 501].includes(error.status)
        state(unsupported ? 'local' : 'error')
      } finally {
        applying = false
      }
    })
    return chain
  }

  const refresh = () =>
    enqueue(async () => {
      const initial = !initialized
      const { remote } = await request('GET')
      if (initial || remote.rev > revision) await merge(remote, initial)
      else if (remote.rev < revision) throw new Error('同步版本回退，已保留本机资料')
      if (remote.rev === 0 || serialize(options.getLocal()) !== confirmed) await push()
    })

  function schedulePush() {
    if (!scope.isCurrent() || unsupported) return
    if (pushTimer !== null) window.clearTimeout(pushTimer)
    pushTimer = window.setTimeout(() => {
      pushTimer = null
      if (!initialized) void refresh()
      else void enqueue(push)
    }, options.debounceMs)
  }

  return {
    scope,
    refresh,
    async start() {
      if (started || !scope.isCurrent()) return
      started = true
      unsubs.push(
        options.subscribeLocal(() => {
          if (applying || !scope.isCurrent() || unsupported) return
          if (!initialized) void refresh()
          else if (serialize(options.getLocal()) !== confirmed) schedulePush()
        }),
        wsBus.subscribe((message) => {
          if (
            message.type === 'user_store_updated' &&
            message.kind === options.kind &&
            typeof message.rev === 'number' &&
            message.rev > revision
          )
            void refresh()
        }),
      )
      await refresh()
      if (scope.isCurrent() && !unsupported) {
        pollTimer = window.setInterval(() => void refresh(), options.pollMs)
      }
    },
    stop() {
      scope.close()
      if (pushTimer !== null) window.clearTimeout(pushTimer)
      if (pollTimer !== null) window.clearInterval(pollTimer)
      for (const unsubscribe of unsubs) unsubscribe()
    },
  }
}
