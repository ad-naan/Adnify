import type { PrivilegeCapability } from './systemPrivilege'

export type FileMutationErrorCode =
  | 'permission_denied'
  | 'policy_denied'
  | 'invalid_request'
  | 'not_found'
  | 'locked'
  | 'disk_full'
  | 'io_error'

export interface FileMutationError {
  code: FileMutationErrorCode
  message?: string
  capability?: PrivilegeCapability
}

export type FileMutationResult<T = undefined> =
  | { success: true; value?: T }
  | { success: false; error: FileMutationError }
