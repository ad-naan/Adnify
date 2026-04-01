import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'

const createMock = vi.fn()
const writeMock = vi.fn()
const resizeMock = vi.fn()
const killMock = vi.fn()
let dataHandler: ((event: { id: string; data: string; seq: number; occurredAt: number }) => void) | null = null
let exitHandler: ((event: { id: string; exitCode: number; signal?: number; seq: number; occurredAt: number; reason: 'process_exit' | 'killed_by_user' | 'remote_close' }) => void) | null = null

vi.mock('@renderer/services/electronAPI', () => ({
  api: {
    terminal: {
      create: createMock,
      write: writeMock,
      resize: resizeMock,
      kill: killMock,
      onData: vi.fn((handler) => {
        dataHandler = handler
        return () => { dataHandler = null }
      }),
      onExit: vi.fn((handler) => {
        exitHandler = handler
        return () => { exitHandler = null }
      }),
      onError: vi.fn((_handler) => {
        return () => {}
      }),
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

vi.mock('@xterm/xterm', () => ({
  Terminal: class MockTerminal {
    options: Record<string, unknown> = {}
    write = vi.fn()
    focus = vi.fn()
    loadAddon = vi.fn()
    open = vi.fn()
    dispose = vi.fn()
    onData = vi.fn()
    attachCustomKeyEventHandler = vi.fn()
    getSelection = vi.fn(() => '')
    clear = vi.fn()
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class MockFitAddon {
    fit = vi.fn()
    dispose = vi.fn()
    proposeDimensions = vi.fn(() => ({ cols: 120, rows: 30 }))
  },
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class MockWebLinksAddon {},
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class MockWebglAddon {
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

vi.mock('@services/keybindingService', () => ({
  isMac: true,
}))

vi.mock('@renderer/agent/tools/commandRuntime', () => ({
  getInteractiveTerminalBackend: vi.fn(() => 'pipe'),
}))

describe('TerminalManager command sessions', () => {
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
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'session-uuid') })
    vi.stubGlobal('navigator', { userAgent: 'Macintosh' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('tracks detached background commands as last session state', async () => {
    const { terminalManager } = await import('@renderer/services/TerminalManager')

    try {
      const termId = await terminalManager.getOrCreateAgentTerminal('/tmp/adnify-agent')
      const session = terminalManager.recordDetachedCommand(termId, 'npm run dev', '/tmp/adnify-agent', 'agent')
      const state = terminalManager.getTerminalCommandState(termId)

      expect(session.status).toBe('detached')
      expect(state.current).toBeNull()
      expect(state.last?.status).toBe('detached')
      expect(state.last?.command).toBe('npm run dev')
    } finally {
      terminalManager.cleanup()
    }
  })

  it('finalizes command when terminal exits before sentinel matches', async () => {
    const { terminalManager } = await import('@renderer/services/TerminalManager')

    try {
      const termId = await terminalManager.getOrCreateAgentTerminal('/tmp/adnify-agent')
      const resultPromise = terminalManager.executeCommandWithOutput(termId, 'npm test', 5000, '/tmp/adnify-agent')

      expect(writeMock).toHaveBeenCalledTimes(1)
      dataHandler?.({ id: termId, data: 'partial output\n', seq: 1, occurredAt: Date.now() })
      exitHandler?.({ id: termId, exitCode: 7, seq: 2, occurredAt: Date.now(), reason: 'process_exit' })

      const result = await resultPromise
      const state = terminalManager.getTerminalCommandState(termId)

      expect(result.finalStatus).toBe('shell_exited')
      expect(result.exitCode).toBe(7)
      expect(result.success).toBe(false)
      expect(state.current).toBeNull()
      expect(state.last?.status).toBe('shell_exited')
      expect(state.last?.terminationReason).toBe('terminal_exit')
    } finally {
      terminalManager.cleanup()
    }
  })
})
