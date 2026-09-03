import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  diagnostics: new Map<string, any[]>(),
  readFull: vi.fn(),
  executeSecure: vi.fn(),
  getServerStatus: vi.fn(),
  didOpenDocument: vi.fn(),
  ensureServerForFile: vi.fn(),
  waitForDiagnostics: vi.fn(),
}))

vi.mock('@/renderer/services/electronAPI', () => ({
  api: {
    file: {
      exists: vi.fn().mockResolvedValue(false),
      readFull: mocks.readFull,
    },
    lsp: {
      getServerStatus: mocks.getServerStatus,
    },
    shell: {
      executeSecure: mocks.executeSecure,
    },
  },
}))

vi.mock('@services/diagnosticsStore', () => ({
  useDiagnosticsStore: {
    getState: () => ({ diagnostics: mocks.diagnostics }),
  },
}))

vi.mock('@services/lspService', () => ({
  didOpenDocument: mocks.didOpenDocument,
  ensureServerForFile: mocks.ensureServerForFile,
  getFileWorkspaceRoot: () => 'D:/workspace',
  getLanguageId: () => 'typescript',
  waitForDiagnostics: mocks.waitForDiagnostics,
}))

import { lintService } from '@/renderer/agent/services/lintService'

const filePath = 'D:/workspace/example.ts'
const uri = 'file:///D:/workspace/example.ts'

function diagnostic(message: string) {
  return {
    code: 'TS2322',
    message,
    severity: 1,
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    },
  }
}

describe('lintService forced refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lintService.clearCache()
    mocks.diagnostics.clear()
    mocks.diagnostics.set(uri, [diagnostic('stale error')])
    mocks.readFull.mockResolvedValue('const value: string = "fixed"\n')
    mocks.getServerStatus.mockResolvedValue({ typescript: { installed: true } })
    mocks.ensureServerForFile.mockResolvedValue(true)
    mocks.didOpenDocument.mockImplementation(async () => {
      mocks.diagnostics.set(uri, [diagnostic('fresh error')])
      return true
    })
    mocks.waitForDiagnostics.mockResolvedValue(true)
  })

  it('syncs the latest file content and returns diagnostics published after the edit', async () => {
    const result = await lintService.getLintErrors(filePath, true)

    expect(mocks.waitForDiagnostics).toHaveBeenCalledWith(filePath)
    expect(mocks.didOpenDocument).toHaveBeenCalledWith(
      filePath,
      'const value: string = "fixed"\n',
    )
    expect(mocks.waitForDiagnostics.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.didOpenDocument.mock.invocationCallOrder[0])
    expect(result.errors.map(error => error.message)).toEqual(['fresh error'])
    expect(mocks.executeSecure).not.toHaveBeenCalled()
  })

  it('uses the current editor text when checking an unsaved document', async () => {
    const editorContent = 'const value: string = "unsaved"\n'

    await lintService.getLintErrors(filePath, true, editorContent)

    expect(mocks.readFull).not.toHaveBeenCalled()
    expect(mocks.didOpenDocument).toHaveBeenCalledWith(filePath, editorContent)
  })
})
