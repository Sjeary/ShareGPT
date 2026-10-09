import { errorText } from './userFacingError.ts'

export function userFacingAiWorkspaceError(error: unknown): string | null {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : ''
  const message = errorText(error)

  if (
    code === 'STALE_AI_WORKSPACE' ||
    /网页运行状态已变化|网页或标签已经变化|当前网页标签已经变化|账号已切换|操作已取消|发送确认已失效/.test(
      message,
    )
  ) {
    return null
  }
  return message || '操作失败，请重试'
}
