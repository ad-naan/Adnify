import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolvePackageBin } from '@main/lsp/serverDiscovery'

const tempDirs: string[] = []

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

describe('LSP npm server discovery', () => {
  it('uses package bin metadata instead of a version-specific hardcoded path', () => {
    const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adnify-lsp-'))
    tempDirs.push(installDir)
    const packageDir = path.join(installDir, 'node_modules', 'pyright')
    fs.mkdirSync(packageDir, { recursive: true })
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
      bin: { 'pyright-langserver': 'langserver.index.js' },
    }))
    fs.writeFileSync(path.join(packageDir, 'langserver.index.js'), '')

    expect(resolvePackageBin(installDir, 'pyright', 'pyright-langserver'))
      .toBe(path.join(packageDir, 'langserver.index.js'))
  })

  it('does not report a package whose declared executable is missing', () => {
    const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adnify-lsp-'))
    tempDirs.push(installDir)
    const packageDir = path.join(installDir, 'node_modules', 'pyright')
    fs.mkdirSync(packageDir, { recursive: true })
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
      bin: { 'pyright-langserver': 'missing.js' },
    }))

    expect(resolvePackageBin(installDir, 'pyright', 'pyright-langserver')).toBeNull()
  })
})
