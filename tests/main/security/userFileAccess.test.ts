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
})
