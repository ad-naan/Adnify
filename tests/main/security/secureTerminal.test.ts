import { EventEmitter } from 'events'
import * as fs from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '@shared/utils/Logger'
import { commandApprovalScope } from '@shared/security/executionPolicy'

const { handlers, childSpawnMock, dugiteExecMock, requestApprovalMock, runPipedShellCommandMock } = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  childSpawnMock: vi.fn(),
  dugiteExecMock: vi.fn(),
  requestApprovalMock: vi.fn(),
  runPipedShellCommandMock: vi.fn(),
}))

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => process.cwd()),
    getPath: vi.fn(() => '.'),
    isPackaged: false,
  },
  BrowserWindow: class MockBrowserWindow {
    static fromWebContents = vi.fn(() => null)
  },
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
  exec: dugiteExecMock,
}))

vi.mock('@main/security/pipedShell', () => ({
  runPipedShellCommand: runPipedShellCommandMock,
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
    requestApproval: requestApprovalMock,
  },
}))

describe('secureTerminal', () => {
  beforeEach(() => {
    handlers.clear()
    childSpawnMock.mockReset()
    dugiteExecMock.mockReset()
    requestApprovalMock.mockReset().mockResolvedValue(true)
    runPipedShellCommandMock.mockReset().mockResolvedValue({
      success: true,
      stdout: '',
      stderr: '',
      exitCode: 0,
      signal: null,
      timedOut: false,
      truncated: false,
      durationMs: 1,
    })
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
  })

  afterEach(async () => {
    const module = await import('@main/security/secureTerminal')
    module.cleanupTerminals()
    vi.unstubAllEnvs()
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

    expect(dugiteExecMock).toHaveBeenCalled()
    expect(result).toMatchObject({
      success: false,
      exitCode: 1,
    })
    expect(dugiteExecMock).toHaveBeenCalled()
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

  it('treats a non-repository git query as an expected miss', async () => {
    const workspaceRoot = process.cwd()
    const args = [
      '-c',
      'core.quotePath=false',
      'log',
      '-240',
      '--pretty=format:%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%P',
    ]
    dugiteExecMock.mockResolvedValue({
      exitCode: 128,
      stdout: '',
      stderr: 'fatal: not a git repository (or any of the parent directories): .git\n',
    })

    const module = await import('@main/security/secureTerminal')
    module.registerSecureTerminalHandlers(
      () => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any,
      () => ({ roots: [workspaceRoot] }),
    )

    const handler = handlers.get('git:execSecure')
    const result = await handler?.({ sender: { id: 1 } }, args, workspaceRoot)

    expect(result).toMatchObject({ success: false, exitCode: 128 })
    expect(logger.security.debug).toHaveBeenCalledWith('[Git] dugite query returned non-zero:', args)
    expect(logger.security.error).not.toHaveBeenCalledWith(
      '[Git] dugite exec failed:',
      args,
      'fatal: not a git repository (or any of the parent directories): .git\n',
    )
  })

  it('launches Windows cmd and bat shims through cmd.exe', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.stubEnv('ComSpec', 'C:\\Windows\\System32\\cmd.exe')
    const workspaceRoot = process.cwd()

    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
    }
    child.stdout = stdout
    child.stderr = stderr
    childSpawnMock.mockImplementation(() => {
      queueMicrotask(() => child.emit('close', 0))
      return child
    })

    const module = await import('@main/security/secureTerminal')
    module.registerSecureTerminalHandlers(
      () => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any,
      () => ({ roots: [workspaceRoot] }),
    )

    const handler = handlers.get('shell:executeSecure')
    const result = await handler?.({}, {
      command: 'tsc.cmd',
      args: ['--noEmit', '--pretty', 'false'],
      cwd: workspaceRoot,
    })

    expect(result).toMatchObject({ success: true, exitCode: 0 })
    expect(childSpawnMock).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/s', '/c', 'call', 'tsc.cmd', '--noEmit', '--pretty', 'false'],
      expect.objectContaining({ cwd: workspaceRoot }),
    )
  })

  it('turns a Dock-approved untrusted command into a one-use execution authorization', async () => {
    const workspaceRoot = process.cwd()
    const module = await import('@main/security/secureTerminal')
    module.registerSecureTerminalHandlers(
      () => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any,
      () => ({ roots: [workspaceRoot] }),
    )

    const authorize = handlers.get('security:authorizeCommand')
    const runPiped = handlers.get('shell:runPiped')
    const command = 'custom-tool --check'
    const authorization = await authorize?.({}, {
      command,
      cwd: workspaceRoot,
      approval: {
        requestId: 'request-1',
        toolCallId: 'tool-1',
        approvedAt: Date.now(),
        scope: commandApprovalScope(command, workspaceRoot),
      },
    })

    expect(authorization).toMatchObject({ allowed: true, risk: 'elevated' })
    expect(authorization.authorizationId).toBeTypeOf('string')
    expect(requestApprovalMock).not.toHaveBeenCalled()

    await runPiped?.({}, {
      command,
      cwd: workspaceRoot,
      authorizationId: authorization.authorizationId,
    })
    expect(requestApprovalMock).not.toHaveBeenCalled()

    const reused = await runPiped?.({}, {
      command,
      cwd: workspaceRoot,
      authorizationId: authorization.authorizationId,
    })
    expect(reused).toMatchObject({ success: false })
    expect(requestApprovalMock).not.toHaveBeenCalled()
  })

  it('does not execute a dangerous Agent command without Dock approval', async () => {
    const workspaceRoot = process.cwd()
    const module = await import('@main/security/secureTerminal')
    module.registerSecureTerminalHandlers(
      () => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any,
      () => ({ roots: [workspaceRoot] }),
    )

    const authorize = handlers.get('security:authorizeCommand')
    const result = await authorize?.({}, { command: 'rm -rf ./cache', cwd: workspaceRoot })

    expect(result).toMatchObject({ allowed: false, risk: 'dangerous' })
    expect(result.authorizationId).toBeUndefined()
    expect(requestApprovalMock).not.toHaveBeenCalled()
    expect(runPipedShellCommandMock).not.toHaveBeenCalled()
    expect(childSpawnMock).not.toHaveBeenCalled()
  })

  it('uses a scoped Dock approval without opening a second native approval', async () => {
    const workspaceRoot = process.cwd()
    const command = 'custom-tool --check'
    const module = await import('@main/security/secureTerminal')
    module.registerSecureTerminalHandlers(
      () => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any,
      () => ({ roots: [workspaceRoot] }),
    )

    const authorize = handlers.get('security:authorizeCommand')
    const result = await authorize?.({}, {
      command,
      cwd: workspaceRoot,
      approval: {
        requestId: 'request-1',
        toolCallId: 'tool-1',
        approvedAt: Date.now(),
        scope: commandApprovalScope(command, workspaceRoot),
      },
    })

    expect(result).toMatchObject({ allowed: true, risk: 'elevated' })
    expect(requestApprovalMock).not.toHaveBeenCalled()
  })
})
