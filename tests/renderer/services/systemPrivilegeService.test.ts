import { describe, expect, it } from 'vitest'
import { isSystemPermissionError } from '@renderer/services/systemPrivilegeService'

describe('isSystemPermissionError', () => {
  it.each([
    'EACCES: permission denied',
    'EPERM: operation not permitted',
    'Access is denied',
    'System.UnauthorizedAccessException',
    '权限被拒绝',
    '拒绝访问目标目录',
  ])('recognizes permission failures: %s', message => {
    expect(isSystemPermissionError(message)).toBe(true)
  })

  it.each([
    'npm was not found',
    'Network request timed out',
    'Go is not installed',
  ])('does not classify unrelated failures: %s', message => {
    expect(isSystemPermissionError(message)).toBe(false)
  })
})
