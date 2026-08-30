export function userFacingAiWorkspaceError(error: unknown): string | null {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : ''
  const raw = error instanceof Error ? error.message : String(error || '')
  const message = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()

  if (
    code === 'STALE_AI_WORKSPACE' ||
    /网页运行状态已变化|网页或标签已经变化|设置账号已切换|旧操作已取消/.test(message)
  ) {
    return null
  }
  return message || '操作失败，请重试'
}
