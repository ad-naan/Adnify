import { afterEach, describe, expect, it } from 'vitest'
import * as path from 'path'
import {
  authorizeUserFile,
  clearUserFileGrants,
  isUserAuthorizedFile,
} from '../../../src/main/security/userFileAccess'

describe('user file session grants', () => {
  afterEach(() => clearUserFileGrants())

  it('authorizes only the exact normalized file', () => {
    const target = path.resolve('outside', 'library.ts')
    authorizeUserFile(target, 'lsp-navigation')

    expect(isUserAuthorizedFile(target)).toBe(true)
    expect(isUserAuthorizedFile(path.join(path.dirname(target), '.', path.basename(target)))).toBe(true)
    expect(isUserAuthorizedFile(path.resolve('outside', 'sibling.ts'))).toBe(false)
    expect(isUserAuthorizedFile(path.dirname(target))).toBe(false)
  })

  it('authorizes agent-read grants for exact files', () => {
    const target = path.resolve('outside', 'agent-target.ts')
    authorizeUserFile(target, 'agent-read')
    expect(isUserAuthorizedFile(target)).toBe(true)
    expect(isUserAuthorizedFile(path.resolve('outside', 'other.ts'))).toBe(false)
  })

  it('does not let a read grant silently escalate to writes or deletion', () => {
    const target = path.resolve('outside', 'read-only.ts')
    authorizeUserFile(target, 'agent-read', 'read')

    expect(isUserAuthorizedFile(target, 'read')).toBe(true)
    expect(isUserAuthorizedFile(target, 'write')).toBe(false)
    expect(isUserAuthorizedFile(target, 'manage')).toBe(false)
  })

  it('scopes write and manage grants by capability', () => {
    const writeTarget = path.resolve('outside', 'write.ts')
    const manageTarget = path.resolve('outside', 'manage.ts')
    authorizeUserFile(writeTarget, 'agent-write', 'write')
    authorizeUserFile(manageTarget, 'agent-manage', 'manage')

    expect(isUserAuthorizedFile(writeTarget, 'write')).toBe(true)
    expect(isUserAuthorizedFile(writeTarget, 'manage')).toBe(false)
    expect(isUserAuthorizedFile(manageTarget, 'manage')).toBe(true)
  })
})
