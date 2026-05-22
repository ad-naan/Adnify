import { EventEmitter } from 'events'
import * as fs from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '@shared/utils/Logger'

const handlers = new Map<string, Function>()
const childSpawnMock = vi.fn()
const dugiteExecMock = vi.fn()

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
}))

vi.mock('electron', () => ({
  BrowserWindow: class MockBrowserWindow {},
  ipcMain: {
    on: vi.fn(),
  },
}))

vi.mock('child_process', () => ({
  spawn: childSpawnMock,
  execSync: vi.fn(),
  execFile: vi.fn(),
}))

vi.mock('dugite', () => ({
  GitProcess: {
    exec: dugiteExecMock,
  },
}))

vi.mock('@shared/utils/Logger', () => ({
  logger: {
    security: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}))

vi.mock('@shared/utils/errorHandler', () => ({
  toAppError: (err: unknown) => err instanceof Error ? err : new Error(String(err)),
}))

vi.mock('@main/ipc/safeHandle', () => ({
  safeIpcHandle: vi.fn((channel: string, handler: Function) => {
    handlers.set(channel, handler)
  }),
}))

vi.mock('@main/security/securityModule', () => ({
  OperationType: {
    TERMINAL_INTERACTIVE: 'terminal:interactive',
    SHELL_EXECUTE: 'shell:execute',
    GIT_EXEC: 'git:execute',
  },
  securityManager: {
    validateWorkspacePath: vi.fn(() => true),
    logOperation: vi.fn(),
    checkPermission: vi.fn(async () => true),
  },
}))

describe('secureTerminal', () => {
  beforeEach(() => {
    handlers.clear()
    childSpawnMock.mockReset()
    dugiteExecMock.mockReset()
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
  })

  afterEach(async () => {
    const module = await import('@main/security/secureTerminal')
    module.cleanupTerminals()
    vi.restoreAllMocks()
  })

  it('uses pipe on macOS when backend is pipe', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const workspaceRoot = process.cwd()

    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    const stdin = { destroyed: false, write: vi.fn() }
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      stdin: typeof stdin
      killed: boolean
      pid?: number
      kill: ReturnType<typeof vi.fn>
    }
    child.stdout = stdout
    child.stderr = stderr
    child.stdin = stdin
    child.killed = false
    child.pid = 12345
    child.kill = vi.fn(() => {
      child.killed = true
      return true
    })

    childSpawnMock.mockReturnValue(child)

    const module = await import('@main/security/secureTerminal')
    module.registerSecureTerminalHandlers(
      () => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any,
      () => ({ roots: [workspaceRoot] }),
    )

    const handler = handlers.get('terminal:interactive')
    expect(handler).toBeTypeOf('function')

    const result = await handler?.({}, {
      id: 'agent-test',
      cwd: workspaceRoot,
      shell: 'bash',
      backend: 'pipe',
    })

    expect(result).toEqual({ success: true })
    expect(childSpawnMock).toHaveBeenCalledTimes(1)
  })
  it('logs git notes show misses as warnings instead of errors', async () => {
    const workspaceRoot = process.cwd()
    dugiteExecMock.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'error: no note found for object 86436c51be5491ea46e883bc59b96a9786f0e525.\n',
    })

    const module = await import('@main/security/secureTerminal')
    module.registerSecureTerminalHandlers(
      () => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any,
      () => ({ roots: [workspaceRoot] }),
    )

    const handler = handlers.get('git:execSecure')
    expect(handler).toBeTypeOf('function')

    const result = await handler?.({ sender: { id: 1 } }, [
      'notes',
      '--ref',
      'adnify-ai',
      'show',
      '86436c51be5491ea46e883bc59b96a9786f0e525',
    ], workspaceRoot)

    expect(result).toMatchObject({
      success: false,
      exitCode: 1,
    })
    expect(logger.security.warn).toHaveBeenCalledWith(
      '[Git] dugite returned expected non-zero result:',
      ['notes', '--ref', 'adnify-ai', 'show', '86436c51be5491ea46e883bc59b96a9786f0e525'],
      'error: no note found for object 86436c51be5491ea46e883bc59b96a9786f0e525.\n',
    )
    expect(logger.security.error).not.toHaveBeenCalledWith(
      '[Git] dugite exec failed:',
      ['notes', '--ref', 'adnify-ai', 'show', '86436c51be5491ea46e883bc59b96a9786f0e525'],
      'error: no note found for object 86436c51be5491ea46e883bc59b96a9786f0e525.\n',
    )
  })
})
