import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/services/electronAPI', () => ({
  api: {
    file: {
      read: vi.fn(),
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
    maxSingleFileChars: 10000,
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
  pickLocalizedText: vi.fn((zh: string, en: string) => en),
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
})
