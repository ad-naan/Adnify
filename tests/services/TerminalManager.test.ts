import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createMock = vi.fn()
const writeMock = vi.fn()
const resizeMock = vi.fn()
const killMock = vi.fn()
const settingsGetMock = vi.fn()
const settingsSetMock = vi.fn()
let uuidCounter = 0
let dataHandler: ((event: { id: string; data: string; seq: number; occurredAt: number }) => void) | null = null
let exitHandler: ((event: { id: string; exitCode: number; signal?: number; seq: number; occurredAt: number; reason: 'process_exit' | 'killed_by_user' | 'remote_close' }) => void) | null = null

vi.mock('@renderer/services/electronAPI', () => ({
  api: {
    terminal: {
      create: createMock,
      write: writeMock,
      resize: resizeMock,
      kill: killMock,
      onData: vi.fn(handler => {
        dataHandler = handler
        return () => { dataHandler = null }
      }),
      onExit: vi.fn(handler => {
        exitHandler = handler
        return () => { exitHandler = null }
      }),
      onError: vi.fn(() => () => undefined),
    },
    settings: {
      get: settingsGetMock,
      set: settingsSetMock,
    },
  },
}))

vi.mock('@renderer/settings', () => ({
  getEditorConfig: () => ({
    performance: { terminalBufferSize: 1000 },
    terminal: {
      cursorBlink: true,
      fontFamily: 'monospace',
      fontSize: 14,
      lineHeight: 1.4,
      scrollback: 1000,
    },
  }),
}))

class MockBufferLine {
  constructor(readonly text: string, readonly isWrapped = false) {}

  translateToString() {
    return this.text
  }
}

class MockTerminal {
  element: HTMLElement | null = null
  options: Record<string, unknown> = {}
  lines: string[] = ['startup']
  markerCounter = 0
  private oscHandlers = new Map<number, (payload: string) => boolean | Promise<boolean>>()
  write = vi.fn((data: string, callback?: () => void) => {
    const visibleData = data.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    const lines = visibleData.split(/\r?\n/)
    this.lines.push(...(visibleData.endsWith('\n') || visibleData.endsWith('\r') ? lines.slice(0, -1) : lines))
    callback?.()
  })
  focus = vi.fn()
  paste = vi.fn()
  loadAddon = vi.fn()
  open = vi.fn(() => { this.element = {} as HTMLElement })
  dispose = vi.fn()
  onData = vi.fn()
  attachCustomKeyEventHandler = vi.fn()
  getSelection = vi.fn(() => '')
  clear = vi.fn()
  registerOscHandler = vi.fn((id: number, handler: (payload: string) => boolean | Promise<boolean>) => {
    this.oscHandlers.set(id, handler)
    return { dispose: () => this.oscHandlers.delete(id) }
  })
  registerMarker = vi.fn(() => ({ line: this.markerCounter++, dispose: vi.fn() }))

  emitOsc(payload: string) {
    void this.oscHandlers.get(633)?.(payload)
  }

  get buffer() {
    const lines = this.lines
    return {
      active: {
        get length() { return lines.length },
        getLine(line: number) {
          return line >= 0 && line < lines.length
            ? new MockBufferLine(lines[line])
            : null
        },
      },
    }
  }
}

vi.mock('@xterm/xterm', () => ({ Terminal: MockTerminal }))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn()
    dispose = vi.fn()
    proposeDimensions = vi.fn(() => ({ cols: 120, rows: 30 }))
  },
}))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    dispose = vi.fn()
    onContextLoss = vi.fn()
  },
}))
vi.mock('@utils/Logger', () => ({
  logger: {
    system: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  },
}))
vi.mock('@services/keybindingService', () => ({ isMac: true }))
vi.mock('@renderer/agent/tools/commandRuntime', () => ({
  getInteractiveTerminalBackend: vi.fn(() => 'pipe'),
}))

describe('TerminalManager shell integration', () => {
  beforeEach(() => {
    vi.resetModules()
    createMock.mockReset()
    createMock.mockResolvedValue({ success: true })
    writeMock.mockReset()
    resizeMock.mockReset()
    killMock.mockReset()
    dataHandler = null
    exitHandler = null
    vi.useFakeTimers()
    uuidCounter = 0
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `terminal-${++uuidCounter}`) })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('pastes clipboard text through xterm and restores terminal focus', async () => {
    const { terminalManager } = await import('@renderer/services/TerminalManager')

    try {
      const termId = await terminalManager.createTerminal({
        cwd: 'C:\\workspace',
        shell: 'powershell.exe',
        backend: 'pipe',
      })
      const xterm = terminalManager.getXterm(termId) as unknown as MockTerminal

      terminalManager.pasteToTerminal(termId, 'copied elsewhere')

      expect(writeMock).toHaveBeenCalledWith(termId, 'copied elsewhere')
      expect(xterm.focus).toHaveBeenCalledOnce()
    } finally {
      terminalManager.cleanup()
    }
  })

  it('submits raw commands and resolves output from OSC 633 markers', async () => {
    const { terminalManager } = await import('@renderer/services/TerminalManager')

    try {
      const termId = await terminalManager.createTerminal({
        cwd: 'C:\\workspace',
        shell: 'powershell.exe',
        backend: 'pipe',
      })
      const resultPromise = terminalManager.executeCommandWithOutput(
        termId,
        'npm test',
        5000,
        'C:\\work',
      )

      const xterm = terminalManager.getXterm(termId) as unknown as MockTerminal
      xterm.emitOsc('P;Adnify;1')
      await vi.advanceTimersByTimeAsync(50)
      const submitted = writeMock.mock.calls.at(-1)?.[1]
      expect(submitted).toBe("Push-Location 'C:\\work'; npm test; Pop-Location\r")
      expect(submitted).not.toMatch(/9001|Out\.Write|Out-Host|printf/)
      xterm.markerCounter = 1
      xterm.lines.push('$ npm test')
      xterm.emitOsc('C')
      expect(xterm.registerMarker).toHaveBeenCalledTimes(1)
      dataHandler?.({ id: termId, data: 'actual output\r\n', seq: 1, occurredAt: Date.now() })
      xterm.emitOsc('D;7')

      const result = await resultPromise
      expect(result.finalStatus).toBe('failed')
      expect(result.exitCode).toBe(7)
      expect(result.sentinelMatched).toBe(true)
      expect(result.output).toBe('actual output')
      expect(result.terminationReason).toBe('sentinel_matched')
    } finally {
      terminalManager.cleanup()
    }
  })

  it('keeps detached commands native and cwd-safe', async () => {
    const { terminalManager } = await import('@renderer/services/TerminalManager')

    try {
      const termId = await terminalManager.createTerminal({
        cwd: '/tmp/adnify',
        shell: '/bin/zsh',
        backend: 'pipe',
      })
      terminalManager.executeDetachedCommand(termId, "npm run dev -- --host '0.0.0.0'", '/tmp/project')

      expect(writeMock).toHaveBeenLastCalledWith(
        termId,
        "cd '/tmp/project' && npm run dev -- --host '0.0.0.0'\n",
      )
    } finally {
      terminalManager.cleanup()
    }
  })

  it('does not report fake success for cmd.exe integration', async () => {
    const { terminalManager } = await import('@renderer/services/TerminalManager')

    try {
      const termId = await terminalManager.createTerminal({
        cwd: 'C:\\workspace',
        shell: 'cmd.exe',
        backend: 'pipe',
      })
      const result = await terminalManager.executeCommandWithOutput(termId, 'npm test', 5000)

      expect(result.success).toBe(false)
      expect(result.finalStatus).toBe('failed')
      expect(result.exitCode).toBeNull()
      expect(result.terminationReason).toBe('shell_integration_missing')
      expect(writeMock).not.toHaveBeenCalledWith(termId, 'npm test\r')
    } finally {
      terminalManager.cleanup()
    }
  })

  it('marks integration ready from the raw terminal stream without xterm OSC support', async () => {
    const { terminalManager } = await import('@renderer/services/TerminalManager')

    try {
      const termId = await terminalManager.createTerminal({
        cwd: 'E:\\workspace',
        shell: 'powershell.exe',
        backend: 'pipe',
      })
      const resultPromise = terminalManager.executeCommandWithOutput(termId, 'npm test', 5000)

      dataHandler?.({
        id: termId,
        data: '\x1b[2J\x1b[H\x1b]0;C:\\windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\x07\x1b[?25h\x1b]633;P;Adnify;1\x07',
        seq: 1,
        occurredAt: Date.now(),
      })
      await vi.advanceTimersByTimeAsync(100)

      expect(writeMock).toHaveBeenLastCalledWith(termId, 'npm test\r')
      const xterm = terminalManager.getXterm(termId) as unknown as MockTerminal
      xterm.lines.length = 0
      xterm.emitOsc('C')
      xterm.markerCounter = 1
      dataHandler?.({ id: termId, data: 'actual output\r\n', seq: 2, occurredAt: Date.now() })
      xterm.emitOsc('D;7')

      const result = await resultPromise
      expect(result.output).toBe('actual output')
      expect(result.exitCode).toBe(7)
      expect(result.terminationReason).toBe('sentinel_matched')
    } finally {
      terminalManager.cleanup()
    }
  })

  it('preserves integration state before the terminal UI is mounted and reports real shell exit', async () => {
    const { terminalManager } = await import('@renderer/services/TerminalManager')

    try {
      const termId = await terminalManager.createTerminal({
        cwd: '/tmp/adnify',
        shell: '/bin/bash',
        backend: 'pipe',
      })
      const resultPromise = terminalManager.executeCommandWithOutput(termId, 'npm test', 5000)
      const xterm = terminalManager.getXterm(termId) as unknown as MockTerminal
      xterm.emitOsc('P;Adnify')
      await vi.advanceTimersByTimeAsync(0)

      dataHandler?.({ id: termId, data: 'partial output\n', seq: 1, occurredAt: Date.now() })
      exitHandler?.({ id: termId, exitCode: 7, seq: 2, occurredAt: Date.now(), reason: 'process_exit' })

      const result = await resultPromise
      expect(result.finalStatus).toBe('shell_exited')
      expect(result.exitCode).toBe(7)
      expect(result.terminationReason).toBe('terminal_exit')
    } finally {
      terminalManager.cleanup()
    }
  })

  it('captures short output that arrives in the same PTY chunk as command end', async () => {
    const { terminalManager } = await import('@renderer/services/TerminalManager')

    try {
      const termId = await terminalManager.createTerminal({
        cwd: 'E:\\workspace',
        shell: 'powershell.exe',
        backend: 'pipe',
      })
      const resultPromise = terminalManager.executeCommandWithOutput(termId, 'echo Hello', 5000)
      const xterm = terminalManager.getXterm(termId) as unknown as MockTerminal
      dataHandler?.({ id: termId, data: '\x1b]633;A\x07', seq: 1, occurredAt: Date.now() })
      await vi.advanceTimersByTimeAsync(50)

      xterm.lines.length = 0
      xterm.lines.push('echo Hello')
      xterm.markerCounter = 1
      xterm.emitOsc('C')
      dataHandler?.({
        id: termId,
        data: 'Hello\r\n\x1b]633;D;0\x07',
        seq: 2,
        occurredAt: Date.now(),
      })

      const result = await resultPromise
      expect(result.output).toBe('Hello')
      expect(result.exitCode).toBe(0)
      expect(result.success).toBe(true)
      expect(result.terminationReason).toBe('sentinel_matched')
    } finally {
      terminalManager.cleanup()
    }
  })

  it('keeps the executing parser alive when terminal UI is unmounted', async () => {
    const { terminalManager } = await import('@renderer/services/TerminalManager')

    try {
      const termId = await terminalManager.createTerminal({
        cwd: 'C:\\workspace',
        shell: 'powershell.exe',
        backend: 'pipe',
      })
      const resultPromise = terminalManager.executeCommandWithOutput(termId, 'npm test', 5000)
      const xterm = terminalManager.getXterm(termId) as unknown as MockTerminal
      xterm.emitOsc('P;Adnify;1')
      await vi.advanceTimersByTimeAsync(50)

      terminalManager.unmountTerminal(termId)
      xterm.markerCounter = 1
      xterm.emitOsc('C')
      dataHandler?.({ id: termId, data: 'output after unmount\r\n', seq: 1, occurredAt: Date.now() })
      xterm.emitOsc('D;7')

      const result = await resultPromise
      expect(result.terminationReason).not.toBe('terminal_error')
      expect(result.output).toBe('output after unmount')
      expect(result.exitCode).toBe(7)
      expect(writeMock).toHaveBeenLastCalledWith(termId, 'npm test\r')
    } finally {
      terminalManager.cleanup()
    }
  })

  it('finishes at prompt recovery when command-end marker is missing', async () => {
    const { terminalManager } = await import('@renderer/services/TerminalManager')

    try {
      const termId = await terminalManager.createTerminal({
        cwd: 'C:\\workspace',
        shell: 'powershell.exe',
        backend: 'pipe',
      })
      const resultPromise = terminalManager.executeCommandWithOutput(termId, 'npm test', 30_000)
      const xterm = terminalManager.getXterm(termId) as unknown as MockTerminal
      xterm.emitOsc('P;Adnify;1')
      await vi.advanceTimersByTimeAsync(50)

      xterm.emitOsc('C')
      xterm.markerCounter = 1
      dataHandler?.({ id: termId, data: 'actual output\r\n', seq: 1, occurredAt: Date.now() })
      xterm.emitOsc('A')

      const result = await resultPromise
      expect(result.terminationReason).toBe('sentinel_missing_prompt')
      expect(result.output).toBe('actual output')
      expect(result.exitCode).toBeNull()
      expect(result.success).toBe(false)
      expect(result.timedOut).toBe(false)
    } finally {
      terminalManager.cleanup()
    }
  })

  it('closes stale integration-failed agent terminals before creating a replacement', async () => {
    const { terminalManager } = await import('@renderer/services/TerminalManager')

    try {
      const staleId = await terminalManager.createTerminal({
        cwd: 'C:\\workspace',
        shell: 'powershell.exe',
        backend: 'pipe',
        isAgent: true,
      })
      const failed = terminalManager.executeCommandWithOutput(staleId, 'npm test', 10)
      await vi.advanceTimersByTimeAsync(10)
      await expect(failed).resolves.toMatchObject({
        terminationReason: 'shell_integration_missing',
      })
      terminalManager.releaseAgentTerminal(staleId)

      const termId = await terminalManager.getOrCreateAgentTerminal('C:\\workspace', {
        name: 'Agent',
      })

      expect(termId).not.toBe(staleId)
      expect(terminalManager.hasTerminal(staleId)).toBe(false)
    } finally {
      terminalManager.cleanup()
    }
  })

  it('reclaims an idle agent terminal before hitting the main-process terminal ceiling', async () => {
    const { terminalManager } = await import('@renderer/services/TerminalManager')

    try {
      const userTerminalIds: string[] = []
      for (let index = 0; index < 10; index += 1) {
        userTerminalIds.push(await terminalManager.createTerminal({
          cwd: `C:\\workspace-${index}`,
          shell: 'powershell.exe',
          backend: 'pipe',
          isAgent: index === 0,
        }))
      }

      const agentTerminalId = await terminalManager.getOrCreateAgentTerminal('C:\\workspace', {
        name: 'Agent',
      })

      expect(terminalManager.hasTerminal(agentTerminalId)).toBe(true)
      expect(terminalManager.getState().terminals).toHaveLength(10)
      expect(terminalManager.hasTerminal(userTerminalIds[0])).toBe(false)
    } finally {
      terminalManager.cleanup()
    }
  })
})
