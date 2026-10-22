import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/services/electronAPI', () => ({
  api: {
    file: {
      readFull: vi.fn(),
      readRichContent: vi.fn(),
      readImageAnalysis: vi.fn(),
      write: vi.fn(),
      readDir: vi.fn(),
    },
    http: {
      webSearch: vi.fn(() => new Promise(() => {})),
      readUrl: vi.fn(),
    },
    index: {
      parseCallGraph: vi.fn(async () => []),
    },
  },
}))

vi.mock('@renderer/agent/services/imageReadService', () => ({
  analyzeImageSource: vi.fn(),
  getReadImageUnavailableMessage: vi.fn(() => 'Error: read_image requires a configured multimodal model.'),
  getReadRichContentOptions: vi.fn(() => ({})),
}))

vi.mock('@renderer/services/lspService', () => ({
  waitForDiagnostics: vi.fn(),
  isLanguageSupported: vi.fn(() => false),
  getLanguageId: vi.fn(() => 'typescript'),
  didOpenDocument: vi.fn(),
}))

vi.mock('@renderer/agent/utils/AgentConfig', () => ({
  getAgentConfig: vi.fn(() => ({
    maxToolResultChars: 10000,
    toolTimeoutMs: 20,
    ignoredDirectories: [],
  })),
}))

vi.mock('@renderer/agent/services/fileCacheService', () => ({
  fileCacheService: {
    markFileAsRead: vi.fn(),
  },
}))

vi.mock('@renderer/agent/services/lintService', () => ({
  lintService: {},
}))

vi.mock('@renderer/agent/services/memoryService', () => ({
  memoryService: {},
  normalizeMemoryContentInput: vi.fn(),
}))

vi.mock('@/renderer/store', () => ({
  useStore: {
    getState: vi.fn(() => ({
      setTerminalVisible: vi.fn(),
      llmConfig: {},
    })),
  },
}))

vi.mock('@/renderer/agent/orchestration', () => ({
  SubAgentManager: {
    spawn: vi.fn(() => new Promise(resolve => {
      setTimeout(() => resolve({
        success: true,
        output: 'sub-agent complete',
        subAgentId: 'sub-1',
        threadId: 'thread-1',
        durationMs: 50,
      }), 50)
    })),
  },
}))

vi.mock('@renderer/agent/services/composerService', () => ({
  composerService: {
    ensureSession: vi.fn(),
    addChange: vi.fn(),
  },
}))

vi.mock('@renderer/agent/store/agentStoreBridge', () => ({
  agentStorePlanBridge: {},
  agentStoreTodoBridge: {},
}))

vi.mock('@renderer/agent/utils/fileChangeUtils', () => ({
  buildFileChangeDescriptor: vi.fn(() => ({})),
}))

vi.mock('@renderer/agent/tools/commandRuntime', () => ({
  isLongRunningCommand: vi.fn(() => false),
}))

vi.mock('@renderer/services/internalWriteTracker', () => ({
  internalWriteTracker: {
    mark: vi.fn(),
  },
}))

vi.mock('@renderer/agent/services/skillService', () => ({
  skillService: {},
}))

vi.mock('@renderer/agent/utils/agentText', () => ({
  getAgentLanguage: vi.fn(() => 'en'),
  translateAgentText: vi.fn((key: string) => key),
}))

vi.mock('@renderer/agent/tools/fileWriteStrategy', () => ({
  guardWriteFile: vi.fn(),
}))

vi.mock('@utils/Logger', () => ({
  logger: {
    agent: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}))

import { toolExecutors } from '@renderer/agent/tools/executors'

describe('toolExecutors timeout wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses the configured agent tool timeout for the wrapper', async () => {
    const resultPromise = toolExecutors.web_search({ query: 'timeout test' }, {} as any)
    await vi.advanceTimersByTimeAsync(20)
    const result = await resultPromise

    expect(result.success).toBe(false)
    expect(result.error).toContain('Tool execution error')
  })

  it('lets the sub-agent manager own task timeouts', async () => {
    const resultPromise = toolExecutors.task(
      { description: 'inspect symbols', prompt: 'inspect the project' },
      { workspacePath: '/workspace' } as any,
    )
    await vi.advanceTimersByTimeAsync(50)
    const result = await resultPromise

    expect(result.success).toBe(true)
    expect(result.result).toBe('sub-agent complete')
  })
  it('passes a sub-agent failure through the error field instead of producing Unknown error', async () => {
    const { SubAgentManager } = await import('@/renderer/agent/orchestration')
    vi.mocked(SubAgentManager.spawn).mockResolvedValueOnce({
      success: false, error: 'Sub-agent timed out after 300000ms of inactivity', subAgentId: 'sub-failed',
    })
    const result = await toolExecutors.task(
      { description: 'inspect symbols', prompt: 'inspect the project' },
      { workspacePath: '/workspace' } as any,
    )
    expect(result.success).toBe(false)
    expect(result.error).toBe('Sub-agent timed out after 300000ms of inactivity')
    expect(result.result).toBe(result.error)
  })

  it('provides a specific fallback error when the manager has no error message', async () => {
    const { SubAgentManager } = await import('@/renderer/agent/orchestration')
    vi.mocked(SubAgentManager.spawn).mockResolvedValueOnce({ success: false, subAgentId: 'sub-failed' })
    const result = await toolExecutors.task(
      { description: 'inspect symbols', prompt: 'inspect the project' },
      { workspacePath: '/workspace' } as any,
    )
    expect(result.error).toBe('Sub-agent failed.')
  })

  it('passes the parent cancellation signal to the sub-agent manager', async () => {
    const { SubAgentManager } = await import('@/renderer/agent/orchestration')
    const parent = new AbortController()
    const resultPromise = toolExecutors.task(
      { description: 'inspect symbols', prompt: 'inspect the project' },
      { workspacePath: '/workspace', abortSignal: parent.signal } as any,
    )
    await vi.advanceTimersByTimeAsync(50)
    await resultPromise
    expect(SubAgentManager.spawn).toHaveBeenLastCalledWith(
      expect.anything(), expect.anything(), '/workspace', undefined, undefined,
      expect.objectContaining({ abortSignal: parent.signal }),
    )
  })
})
