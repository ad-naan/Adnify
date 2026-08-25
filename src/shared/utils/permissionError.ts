const PERMISSION_ERROR_CODES = new Set(['EACCES', 'EPERM'])
const PERMISSION_ERROR_PATTERN = /\b(?:EACCES|EPERM)\b|permission denied|access (?:is )?denied|operation not permitted|UnauthorizedAccessException|权限(?:不足|被拒绝|错误)|拒绝访问/i

export function isSystemPermissionError(error: unknown): boolean {
  if (!error) return false
  const code = typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (PERMISSION_ERROR_CODES.has(code.toUpperCase())) return true
  const message = error instanceof Error ? error.message : String(error)
  return PERMISSION_ERROR_PATTERN.test(message)
}
