import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getNpxCommand, joinPath, platform } from '@shared/utils/pathUtils'

const mocks = vi.hoisted(() => ({
  diagnostics: new Map<string, any[]>(),
  exists: vi.fn(),
  readFull: vi.fn(),
  executeSecure: vi.fn(),
  getServerStatus: vi.fn(),
  didOpenDocument: vi.fn(),
  ensureServerForFile: vi.fn(),
  findBestRoot: vi.fn(),
  waitForDiagnostics: vi.fn(),
}))

vi.mock('@/renderer/services/electronAPI', () => ({
  api: {
    file: {
      exists: mocks.exists,
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
  findBestRoot: mocks.findBestRoot,
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
    mocks.exists.mockResolvedValue(false)
    mocks.findBestRoot.mockResolvedValue('D:/workspace')
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

describe('lintService CLI fallback command resolution', () => {
  const nestedRoot = 'D:/workspace/frontend'
  const nestedFile = 'D:/workspace/frontend/src/App.ts'
  const nestedTsconfig = joinPath(nestedRoot, 'tsconfig.json')
  const nestedTsc = joinPath(nestedRoot, 'node_modules', '.bin', platform.isWindows ? 'tsc.cmd' : 'tsc')

  /** 让 exists 只对给定路径返回 true */
  function existsOnly(...paths: string[]) {
    mocks.exists.mockImplementation(async (candidate: string) => paths.includes(candidate))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    lintService.clearCache()
    // 诊断为空 + LSP 启动失败 → 走 CLI 回退
    mocks.diagnostics.clear()
    mocks.exists.mockResolvedValue(false)
    mocks.findBestRoot.mockResolvedValue(nestedRoot)
    mocks.getServerStatus.mockResolvedValue({ typescript: { installed: true } })
    mocks.ensureServerForFile.mockResolvedValue(false)
    mocks.executeSecure.mockResolvedValue({ output: '', errorOutput: '' })
  })

  it('type-checks against the nearest tsconfig instead of passing the file to tsc', async () => {
    existsOnly(nestedTsconfig, nestedTsc)

    await lintService.getLintErrors(nestedFile, true)

    expect(mocks.executeSecure).toHaveBeenCalledTimes(1)
    const call = mocks.executeSecure.mock.calls[0][0]
    expect(call.command).toBe(nestedTsc)
    expect(call.args).toEqual(['--noEmit', '--pretty', 'false', '--project', nestedTsconfig])
    expect(call.cwd).toBe(nestedRoot)
    // 带文件参数会让 tsc 丢弃整份 tsconfig（路径别名、jsx、全局 .d.ts 全部失效）
    expect(call.args).not.toContain(nestedFile)
  })

  it('falls back to npx inside the project root when the workspace root has no local tsc', async () => {
    existsOnly(nestedTsconfig)

    await lintService.getLintErrors(nestedFile, true)

    const call = mocks.executeSecure.mock.calls[0][0]
    expect(call.command).toBe(getNpxCommand())
    expect(call.args).toEqual(['tsc', '--noEmit', '--pretty', 'false', '--project', nestedTsconfig])
    expect(call.cwd).toBe(nestedRoot)
  })

  it('prefers a hoisted tsc at the workspace root when the nested project has none', async () => {
    const hoistedTsc = joinPath('D:/workspace', 'node_modules', '.bin', platform.isWindows ? 'tsc.cmd' : 'tsc')
    existsOnly(nestedTsconfig, hoistedTsc)

    await lintService.getLintErrors(nestedFile, true)

    const call = mocks.executeSecure.mock.calls[0][0]
    expect(call.command).toBe(hoistedTsc)
    // cwd 跟随 tsconfig 所在的工程根，而不是提供 tsc 的那一层
    expect(call.cwd).toBe(nestedRoot)
  })

  it('only checks a single file when no tsconfig exists, with modern resolution flags', async () => {
    existsOnly(nestedTsc)

    await lintService.getLintErrors(nestedFile, true)

    const call = mocks.executeSecure.mock.calls[0][0]
    expect(call.command).toBe(nestedTsc)
    expect(call.args).not.toContain('--project')
    expect(call.args[call.args.length - 1]).toBe(nestedFile)
    // 默认的 node10 解析读不到 exports-only 包的类型，会误报 react 等依赖缺失
    expect(call.args).toContain('bundler')
    expect(call.args).toContain('react-jsx')
  })

  it('reports diagnostics for the target file from project-wide tsc output', async () => {
    existsOnly(nestedTsconfig, nestedTsc)
    mocks.executeSecure.mockResolvedValue({
      output: [
        'D:/workspace/frontend/src/Other.ts(3,1): error TS2304: Cannot find name \'other\'.',
        'D:/workspace/frontend/src/App.ts(7,5): error TS2307: Cannot find module \'react\'.',
      ].join('\n'),
      errorOutput: '',
    })

    const result = await lintService.getLintErrors(nestedFile, true)

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ code: 'TS2307', startLine: 7, severity: 'error' })
  })
})
