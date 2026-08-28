export function userFacingErrorMessage(error: unknown, fallback = '操作失败'): string {
  let message = error instanceof Error ? error.message : String(error ?? '')
  message = message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^(?:Error:\s*)+/i, '')
    .trim()
  return message || fallback
}
