import { createLatestAttemptCoordinator, StaleAttemptError } from './latestAttempt.ts'

// 共享的认证/工作区进入操作代次协调器：密码登录、邀请注册与自动登录、个人工作区切换共用同一条代次链，
// 任何旧请求（即使来自已卸载的邀请注册页）都不能在用户切换到新登录或离开页面后覆盖当前意图。
export const authAttempts = createLatestAttemptCoordinator()

export interface GuardedInviteRegistrationOptions<TProfile> {
  coordinator?: ReturnType<typeof createLatestAttemptCoordinator>
  signal?: AbortSignal
  register: (signal: AbortSignal) => Promise<{ username: string }>
  afterRegistered?: () => Promise<void>
  loginWithAttempt: (username: string, attempt: number) => Promise<TProfile>
  onStale?: () => void
  onLoginFallback?: (username: string, loginError: unknown) => void
  onCompleted?: (profile: TProfile) => void
}

function assertActive(
  coordinator: ReturnType<typeof createLatestAttemptCoordinator>,
  attempt: number,
  signal?: AbortSignal,
): void {
  if (signal?.aborted) throw new StaleAttemptError()
  coordinator.assertCurrent(attempt)
}

export async function runGuardedInviteRegistration<TProfile>({
  coordinator = authAttempts,
  signal,
  register,
  afterRegistered,
  loginWithAttempt,
  onStale,
  onLoginFallback,
  onCompleted,
}: GuardedInviteRegistrationOptions<TProfile>): Promise<{
  attempt: number
  stale: boolean
  profile?: TProfile
}> {
  const attempt = coordinator.begin()
  const localController = new AbortController()
  const onExternalAbort = () => localController.abort()
  if (signal?.aborted) {
    onStale?.()
    return { attempt, stale: true }
  }
  signal?.addEventListener('abort', onExternalAbort, { once: true })

  try {
    const { username } = await register(localController.signal)
    assertActive(coordinator, attempt, localController.signal)

    if (afterRegistered) {
      await afterRegistered().catch(() => undefined)
      assertActive(coordinator, attempt, localController.signal)
    }

    try {
      const profile = await loginWithAttempt(username, attempt)
      assertActive(coordinator, attempt, localController.signal)
      onCompleted?.(profile)
      return { attempt, stale: false, profile }
    } catch (loginErr) {
      if (
        localController.signal.aborted ||
        !coordinator.isCurrent(attempt) ||
        loginErr instanceof StaleAttemptError ||
        (loginErr instanceof Error && loginErr.name === 'StaleAttemptError')
      ) {
        onStale?.()
        return { attempt, stale: true }
      }
      onLoginFallback?.(username, loginErr)
      return { attempt, stale: false }
    }
  } catch (err) {
    if (
      localController.signal.aborted ||
      !coordinator.isCurrent(attempt) ||
      err instanceof StaleAttemptError ||
      (err instanceof Error && err.name === 'StaleAttemptError')
    ) {
      onStale?.()
      return { attempt, stale: true }
    }
    throw err
  } finally {
    signal?.removeEventListener('abort', onExternalAbort)
  }
}
