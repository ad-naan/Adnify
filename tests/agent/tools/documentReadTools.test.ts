import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/services/electronAPI', () => ({
  api: {
    file: {
      read: vi.fn(),
      readRichContent: vi.fn(),
      readImageAnalysis: vi.fn(),
      write: vi.fn(),
      readDir: vi.fn(),
      stat: vi.fn(),
    },
    index: {
      initialize: vi.fn(),
      searchSymbols: vi.fn(),
      parseCallGraph: vi.fn(async () => []),
    },
    lsp: {
      documentSymbol: vi.fn(),
      workspaceSymbol: vi.fn(),
    },
  },
}))

vi.mock('@renderer/agent/services/imageReadService', () => ({
  analyzeImageSource: vi.fn(),
  getReadImageUnavailableMessage: vi.fn(() => 'Error: read_image requires a configured multimodal model.'),
  getReadRichContentOptions: vi.fn(() => ({
    imageAnalysis: {
      config: { provider: 'openai', model: 'gpt-4.1-mini' },
      prompt: 'Analyze embedded images',
    },
  })),
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
    toolTimeoutMs: 1000,
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
  pickLocalizedText: vi.fn((_zh: string, en: string) => en),
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

import { api } from '@renderer/services/electronAPI'
import { analyzeImageSource, getReadRichContentOptions } from '@renderer/agent/services/imageReadService'
import { didOpenDocument } from '@renderer/services/lspService'
import { toolExecutors } from '@renderer/agent/tools/executors'

describe('document read tool executors', () => {
  const ctx = {
    workspacePath: '/workspace',
    currentAssistantId: 'assistant-1',
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens a source document before requesting semantic symbols', async () => {
    vi.mocked(api.file.read).mockResolvedValue('export class Cache { get() {} }')
    vi.mocked(didOpenDocument).mockResolvedValue(true)
    vi.mocked(api.lsp.documentSymbol).mockResolvedValue([{
      name: 'Cache',
      kind: 5,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 31 } },
      selectionRange: { start: { line: 0, character: 13 }, end: { line: 0, character: 18 } },
      children: [],
    }])

    const result = await toolExecutors.get_document_symbols({ path: 'src/cache.ts' }, ctx)

    expect(result.success).toBe(true)
    expect(didOpenDocument).toHaveBeenCalledWith(
      '/workspace/src/cache.ts',
      'export class Cache { get() {} }',
    )
    expect(api.lsp.documentSymbol).toHaveBeenCalled()
    expect(result.result).toContain('"namePath":"Cache"')
    expect(result.result).toContain('"relativePath":"src/cache.ts"')
    expect(result.result).not.toContain('selectionRange')
  })

  it('reports an unavailable language server as a failure instead of an empty success', async () => {
    vi.mocked(api.file.read).mockResolvedValue('export const value = 1')
    vi.mocked(didOpenDocument).mockResolvedValue(false)

    const result = await toolExecutors.get_document_symbols({ path: 'src/value.ts' }, ctx)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Language server is unavailable')
    expect(api.lsp.documentSymbol).not.toHaveBeenCalled()
  })

  it('guides uncertain document paths back to workspace symbol search', async () => {
    vi.mocked(api.file.read).mockResolvedValue(null)

    const result = await toolExecutors.get_document_symbols({ path: 'src/GuessedController.ts' }, ctx)

    expect(result.success).toBe(false)
    expect(result.error).toContain('use find_symbol without relative_path')
  })

  it('uses a directory relative_path as a scoped symbol search', async () => {
    vi.mocked(api.file.stat).mockResolvedValue({ size: 0, isDirectory: true, isFile: false, mtimeMs: 0 })
    vi.mocked(api.index.searchSymbols).mockResolvedValue([
      { relativePath: 'src/infrastructure/llm/Gateway.ts' },
      { relativePath: 'src/presentation/GatewayView.ts' },
    ] as any)
    vi.mocked(api.file.read).mockResolvedValue('export class Gateway { stream() {} }')
    vi.mocked(didOpenDocument).mockResolvedValue(true)
    vi.mocked(api.lsp.documentSymbol).mockResolvedValue([{
      name: 'Gateway',
      kind: 5,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 38 } },
      selectionRange: { start: { line: 0, character: 13 }, end: { line: 0, character: 20 } },
      children: [{
        name: 'stream',
        kind: 6,
        range: { start: { line: 0, character: 23 }, end: { line: 0, character: 34 } },
        selectionRange: { start: { line: 0, character: 23 }, end: { line: 0, character: 29 } },
      }],
    }])

    const result = await toolExecutors.find_symbol({
      name_path: 'Gateway/stream',
      relative_path: 'src/infrastructure/llm',
    }, ctx)

    expect(result.success).toBe(true)
    expect(result.result).toContain('src/infrastructure/llm/Gateway.ts')
    expect(api.file.read).toHaveBeenCalledTimes(1)
    expect(api.file.read).not.toHaveBeenCalledWith('/workspace/src/presentation/GatewayView.ts', expect.anything(), expect.anything())
  })

  it('routes rich documents through readRichContent', async () => {
    vi.mocked(api.file.readRichContent).mockResolvedValue({
      success: true,
      content: 'Document body\n\nEmbedded image 1:\nChart summary',
      contentKind: 'document',
      sourceFormat: 'docx',
      embeddedImageCount: 1,
      embeddedImagesAnalyzed: 1,
    })

    const result = await toolExecutors.read_file({ path: 'docs/spec.docx' }, ctx)

    expect(result.success).toBe(true)
    expect(result.result).toContain('Document body')
    expect(api.file.readRichContent).toHaveBeenCalledWith(
      '/workspace/docs/spec.docx',
      vi.mocked(getReadRichContentOptions).mock.results[0]?.value,
    )
    expect(api.file.read).not.toHaveBeenCalled()
    expect(result.meta).toMatchObject({
      contentKind: 'document',
      sourceFormat: 'docx',
      embeddedImageCount: 1,
      embeddedImagesAnalyzed: 1,
    })
  })

  it('supports mixed multi-file reads across text and rich documents', async () => {
    vi.mocked(api.file.read).mockResolvedValueOnce('const answer = 42\n')
    vi.mocked(api.file.readRichContent).mockResolvedValueOnce({
      success: true,
      content: 'Quarterly report',
      contentKind: 'document',
      sourceFormat: 'pdf',
      embeddedImageCount: 0,
      embeddedImagesAnalyzed: 0,
    })

    const result = await toolExecutors.read_file({
      paths: ['src/app.ts', 'docs/report.pdf'],
    }, ctx)

    expect(result.success).toBe(true)
    expect(result.result).toContain('--- File: src/app.ts ---')
    expect(result.result).toContain('1: const answer = 42')
    expect(result.result).toContain('--- File: docs/report.pdf ---')
    expect(result.result).toContain('Quarterly report')
  })

  it('executes read_image as a standalone tool', async () => {
    vi.mocked(analyzeImageSource).mockResolvedValue({
      success: true,
      content: '### Image Overview\nA dashboard screenshot.',
      richContent: [
        {
          type: 'markdown',
          title: 'Image Analysis',
          text: '### Image Overview\nA dashboard screenshot.',
        },
      ],
      meta: {
        contentKind: 'image',
        sourceFormat: 'image/png',
      },
    })

    const result = await toolExecutors.read_image({
      path: 'images/dashboard.png',
      prompt: 'Summarize the visible widgets',
    }, ctx)

    expect(result.success).toBe(true)
    expect(analyzeImageSource).toHaveBeenCalledWith({
      path: '/workspace/images/dashboard.png',
      prompt: 'Summarize the visible widgets',
    })
    expect(result.result).toContain('Image Overview')
    expect(result.meta).toMatchObject({
      contentKind: 'image',
      sourceFormat: 'image/png',
    })
  })

  it('automatically routes image paths from read_file into visual analysis', async () => {
    vi.mocked(analyzeImageSource).mockResolvedValue({
      success: true,
      content: 'The screenshot shows a settings panel.',
      richContent: [
        {
          type: 'markdown',
          title: 'Image Analysis',
          text: 'The screenshot shows a settings panel.',
        },
      ],
      meta: {
        contentKind: 'image',
        sourceFormat: 'image/png',
      },
    })

    const result = await toolExecutors.read_file({ path: 'images/settings.png' }, ctx)

    expect(result.success).toBe(true)
    expect(analyzeImageSource).toHaveBeenCalledWith({
      path: '/workspace/images/settings.png',
    })
    expect(result.result).toContain('settings panel')
    expect(result.richContent).toHaveLength(1)
    expect(result.meta).toMatchObject({
      contentKind: 'image',
      filePath: '/workspace/images/settings.png',
      routedFrom: 'read_file',
    })
    expect(api.file.read).not.toHaveBeenCalled()
  })
})
