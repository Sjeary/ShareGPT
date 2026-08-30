export interface ConfirmedLoginResponse {
  token: string
  username: string
}

export async function requireConfirmedLoginResponse<T extends ConfirmedLoginResponse>(
  response: Pick<Response, 'ok' | 'status' | 'text' | 'json'>,
): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `登录失败（${response.status}）`)
  }

  const payload = (await response.json().catch(() => null)) as Partial<T> | null
  if (!payload?.token) throw new Error('登录未成功，请稍后重试')
  if (typeof payload.username !== 'string' || !payload.username.trim()) {
    throw new Error('服务器未返回已确认的账号身份')
  }
  return payload as T
}

export interface LoginTransactionResult<TPrincipal> {
  principal: TPrincipal
  proxyAuthorizationReady: boolean
  proxyAuthorizationError: unknown
}

interface LoginTransactionOptions<TPrincipal> {
  isCurrent: () => boolean
  assertCurrent: () => void | Promise<void>
  activatePrincipal: () => Promise<TPrincipal>
  applyPrincipal: (principal: TPrincipal) => void | Promise<void>
  persistPrincipalSettings: (principal: TPrincipal) => Promise<void>
  enableAdminCapabilities: (principal: TPrincipal) => Promise<void>
  refreshProxyAuthorization: (principal: TPrincipal) => Promise<void>
  publishSession: (principal: TPrincipal) => void | Promise<void>
  rollbackLocalPrincipal: () => Promise<void>
  discardIssuedToken: () => Promise<void>
  reportProxyAuthorizationFailure?: (error: unknown) => void
}

// Collaboration authentication and proxy authorization are separate contracts. A missing or
// unavailable route catalogue must revoke route authorization, but it must not revoke a valid
// collaboration token. Failures in the Principal/settings transaction remain fatal and roll back.
export async function completeCollabLoginTransaction<TPrincipal>(
  options: LoginTransactionOptions<TPrincipal>,
): Promise<LoginTransactionResult<TPrincipal>> {
  let principalTransitionStarted = false
  try {
    principalTransitionStarted = true
    const principal = await options.activatePrincipal()
    await options.assertCurrent()
    await options.applyPrincipal(principal)
    await options.assertCurrent()
    await options.persistPrincipalSettings(principal)
    await options.assertCurrent()
    await options.enableAdminCapabilities(principal)
    await options.assertCurrent()

    let proxyAuthorizationReady = true
    let proxyAuthorizationError: unknown = null
    try {
      await options.refreshProxyAuthorization(principal)
    } catch (error) {
      proxyAuthorizationReady = false
      proxyAuthorizationError = error
      options.reportProxyAuthorizationFailure?.(error)
    }

    await options.assertCurrent()
    await options.publishSession(principal)
    return { principal, proxyAuthorizationReady, proxyAuthorizationError }
  } catch (error) {
    await options.discardIssuedToken().catch(() => undefined)
    if (principalTransitionStarted && options.isCurrent()) {
      try {
        await options.rollbackLocalPrincipal()
      } catch (rollbackError) {
        const recoveryError = new Error('登录失败，且本地账号状态未能恢复，请重新启动应用后再试', {
          cause: error,
        }) as Error & { rollbackError?: unknown }
        recoveryError.rollbackError = rollbackError
        throw recoveryError
      }
    }
    throw error
  }
}
