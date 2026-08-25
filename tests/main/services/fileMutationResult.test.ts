import { describe, expect, it } from 'vitest'
import { classifyFileMutationError, mutationFailureFromError } from '@main/services/fileMutationResult'

describe('file mutation error classification', () => {
  it.each([
    ['EACCES', 'permission_denied'],
    ['EPERM', 'permission_denied'],
    ['ENOENT', 'not_found'],
    ['EBUSY', 'locked'],
    ['ENOSPC', 'disk_full'],
    ['UNKNOWN', 'io_error'],
  ] as const)('maps %s to %s', (code, expected) => {
    expect(classifyFileMutationError(Object.assign(new Error(code), { code }))).toBe(expected)
  })

  it('only attaches an elevation capability to permission failures', () => {
    const denied = mutationFailureFromError(Object.assign(new Error('denied'), { code: 'EACCES' }), 'file.writeProtected')
    const missing = mutationFailureFromError(Object.assign(new Error('missing'), { code: 'ENOENT' }), 'file.writeProtected')

    expect(denied).toMatchObject({ success: false, error: { code: 'permission_denied', capability: 'file.writeProtected' } })
    expect(missing).toMatchObject({ success: false, error: { code: 'not_found' } })
    if (!missing.success) expect(missing.error.capability).toBeUndefined()
  })
})
