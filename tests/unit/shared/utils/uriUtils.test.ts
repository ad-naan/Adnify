import { describe, expect, it } from 'vitest'
import { lspUriToPath, normalizeLspUri, pathToLspUri } from '@shared/utils/uriUtils'

describe('LSP URI utilities', () => {
  it('matches Monaco file URI encoding on Windows paths', () => {
    expect(pathToLspUri('D:\\Project\\a b#c.ts')).toBe('file:///d%3A/Project/a%20b%23c.ts')
  })

  it('round-trips encoded Windows paths', () => {
    const uri = 'file:///e%3A/%E9%A1%B9%E7%9B%AE/a%20b%23c.py'
    expect(lspUriToPath(uri)).toBe('e:\\项目\\a b#c.py')
    expect(normalizeLspUri('file:///E:/项目/a b%23c.py')).toBe(uri)
  })

  it('preserves Unix absolute paths', () => {
    const filePath = '/workspace/a b/main.ts'
    expect(lspUriToPath(pathToLspUri(filePath))).toBe(filePath)
  })

  it('supports UNC paths', () => {
    const filePath = '\\\\server\\share\\a b.ts'
    const uri = 'file://server/share/a%20b.ts'
    expect(pathToLspUri(filePath)).toBe(uri)
    expect(lspUriToPath(uri)).toBe(filePath)
  })
})
