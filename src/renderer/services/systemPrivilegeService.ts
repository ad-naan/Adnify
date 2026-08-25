import { api } from './electronAPI'
import type { ElevationRequestResult, PrivilegeCapability } from '@shared/types/systemPrivilege'

const PERMISSION_ERROR_PATTERNS = [
  /\bEACCES\b/i,
  /\bEPERM\b/i,
  /permission denied/i,
  /access (?:is )?denied/i,
  /operation not permitted/i,
  /UnauthorizedAccessException/i,
  /权限(?:不足|被拒绝|错误)/,
  /拒绝访问/,
]

export function isSystemPermissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '')
  return PERMISSION_ERROR_PATTERNS.some(pattern => pattern.test(message))
}

export async function requestElevationForPermissionError(options: {
  error: unknown
  capability: PrivilegeCapability
  language: 'zh' | 'en'
}): Promise<ElevationRequestResult | null> {
  if (!isSystemPermissionError(options.error)) return null
  return api.systemPrivilege.requestElevation({
    capability: options.capability,
    language: options.language,
  })
}
