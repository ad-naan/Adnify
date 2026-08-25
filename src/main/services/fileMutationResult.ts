import type { FileMutationErrorCode, FileMutationResult } from '@shared/types/fileMutation'
import type { PrivilegeCapability } from '@shared/types/systemPrivilege'

const LOCKED_CODES = new Set(['EBUSY', 'ETXTBSY', 'ENOTEMPTY'])

export function classifyFileMutationError(error: unknown): FileMutationErrorCode {
  const code = error && typeof error === 'object' && 'code' in error
    ? String(error.code).toUpperCase()
    : ''
  if (code === 'EACCES' || code === 'EPERM') return 'permission_denied'
  if (code === 'ENOENT') return 'not_found'
  if (code === 'ENOSPC' || code === 'EDQUOT') return 'disk_full'
  if (LOCKED_CODES.has(code)) return 'locked'
  return 'io_error'
}

export function mutationSuccess<T = undefined>(value?: T): FileMutationResult<T> {
  return value === undefined ? { success: true } : { success: true, value }
}

export function mutationFailure<T = undefined>(
  code: FileMutationErrorCode,
  message?: string,
  capability?: PrivilegeCapability,
): FileMutationResult<T> {
  return { success: false, error: { code, message, capability } }
}

export function mutationFailureFromError<T = undefined>(
  error: unknown,
  capability?: PrivilegeCapability,
): FileMutationResult<T> {
  const code = classifyFileMutationError(error)
  const message = error instanceof Error ? error.message : String(error)
  return mutationFailure(code, message, code === 'permission_denied' ? capability : undefined)
}
