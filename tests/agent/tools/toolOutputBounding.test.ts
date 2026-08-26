/**
 * 执行器的输出边界行为
 *
 * 关注的不是「结果对不对」，而是「结果超预算时模型还能不能继续往下走」：
 *  - 触顶必须被报告，否则「没找到」和「没找完」无法区分。
 *  - 结构化结果必须始终可解析。
 *  - 多文件读取的预算必须先分再拼，否则后面的文件只剩碎片。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/services/electronAPI', () => ({
  api: {
    file: {
      readFull: vi.fn(),
      readRichContent: vi.fn(),
      readImageAnalysis: vi.fn(),
      write: vi.fn(),
      readDir: vi.fn(),
      stat: vi.fn(),
      search: vi.fn(),
    },
    index: {
      initialize: vi.fn(),
      searchSymbols: vi.fn(),
      parseCallGraph: vi.fn(async () => []),
    },
    lsp: {
      documentSymbol: vi.fn(),
      workspaceSymbol: vi.fn(),
      references: vi.fn(),
      getDiagnostics: vi.fn(),
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
    toolTimeoutMs: 1000,
    ignoredDirectories: [],
  })),
}))

vi.mock('@renderer/agent/services/fileCacheService', () => ({
  fileCacheService: { markFileAsRead: vi.fn(), hasValidCache: vi.fn(() => true) },
}))

vi.mock('@renderer/agent/services/lintService', () => ({ lintService: {} }))
vi.mock('@renderer/agent/services/memoryService', () => ({
  memoryService: {},
  normalizeMemoryContentInput: vi.fn(),
}))
vi.mock('@/renderer/store', () => ({
  useStore: { getState: vi.fn(() => ({ setTerminalVisible: vi.fn() })) },
}))
vi.mock('@renderer/agent/services/composerService', () => ({
  composerService: { ensureSession: vi.fn(), addChange: vi.fn() },
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
  internalWriteTracker: { mark: vi.fn() },
}))
vi.mock('@renderer/agent/services/skillService', () => ({ skillService: {} }))
vi.mock('@renderer/agent/utils/agentText', () => ({
  getAgentLanguage: vi.fn(() => 'en'),
  pickLocalizedText: vi.fn((_zh: string, en: string) => en),
  translateAgentText: vi.fn((key: string) => key),
}))
vi.mock('@renderer/agent/tools/fileWriteStrategy', () => ({ guardWriteFile: vi.fn() }))
vi.mock('@utils/Logger', () => ({
  logger: { agent: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}))

import { api } from '@renderer/services/electronAPI'
import { didOpenDocument } from '@renderer/services/lspService'
import { toolExecutors } from '@renderer/agent/tools/executors'

const ctx = { workspacePath: '/workspace', currentAssistantId: 'assistant-1' } as any

/** 造一个必然超出 10000 字符预算的源文件。 */
function hugeSource(lines: number): string {
  return Array.from({ length: lines }, (_, index) => `const value_${index} = ${index}`).join('\n')
}

/** 造 count 个顶层函数符号，每个带 children 个子节点。 */
function manySymbols(count: number, children = 0) {
  return Array.from({ length: count }, (_, index) => ({
    name: `handler_${index}`,
    kind: 12,
    detail: '(args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<Result>',
    range: { start: { line: index * 14, character: 0 }, end: { line: index * 14 + 12, character: 1 } },
    selectionRange: { start: { line: index * 14, character: 6 }, end: { line: index * 14, character: 26 } },
    children: Array.from({ length: children }, (_, child) => ({
      name: `inner_${child}`,
      kind: 13,
      range: { start: { line: index * 14 + child + 1, character: 2 }, end: { line: index * 14 + child + 1, character: 40 } },
      selectionRange: { start: { line: index * 14 + child + 1, character: 8 }, end: { line: index * 14 + child + 1, character: 16 } },
    })),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('read_file 的预算', () => {
  it('单文件超预算时给出可继续的下一次调用参数', async () => {
    vi.mocked(api.file.readFull).mockResolvedValue(hugeSource(4000))

    const result = await toolExecutors.read_file({ path: 'src/big.ts' }, ctx)

    expect(result.success).toBe(true)
    expect(result.result).toContain('TRUNCATED')
    // 关键：不是「文件太大」而已，而是「下一次从第几行开始」。
    expect(result.result).toMatch(/start_line=\d+/)
    expect(result.result.length).toBeLessThanOrEqual(10000)
  })

  it('未超预算时不附加任何截断说明', async () => {
    vi.mocked(api.file.readFull).mockResolvedValue('const a = 1\nconst b = 2\n')

    const result = await toolExecutors.read_file({ path: 'src/small.ts' }, ctx)

    expect(result.result).toContain('1: const a = 1')
    expect(result.result).not.toContain('TRUNCATED')
  })

  it('多文件读取平分预算，后面的文件不会只剩碎片', async () => {
    // 旧行为：每个文件各自按全预算截断再拼接，总长 N 倍，然后被边界层从整体
    // 头尾切一刀 —— 第一个文件基本完整，后面的被切没。
    vi.mocked(api.file.readFull).mockResolvedValue(hugeSource(4000))

    const result = await toolExecutors.read_file({
      paths: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
    }, ctx)

    expect(result.success).toBe(true)
    expect(result.result.length).toBeLessThanOrEqual(10000)
    // 四个文件都必须留下可用的内容，而不是只有第一个。
    for (const path of ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts']) {
      expect(result.result).toContain(`--- File: ${path} ---`)
    }
    expect(result.result.match(/TRUNCATED/g)).toHaveLength(4)
  })
})

describe('search_files 的触顶报告', () => {
  it('单文件命中超上限时报告总数', async () => {
    vi.mocked(api.file.readDir).mockResolvedValue(null as any)
    vi.mocked(api.file.readFull).mockResolvedValue(Array.from({ length: 300 }, () => 'needle here').join('\n'))

    const result = await toolExecutors.search_files({ path: 'src/a.ts', pattern: 'needle' }, ctx)

    expect(result.result).toContain('Found 300 matches')
    expect(result.result).toContain('showing the first 100')
    expect(result.result).toContain('Refine the pattern')
    expect(result.meta?.matchCount).toBe(300)
  })

  it('未触顶时不谈上限', async () => {
    vi.mocked(api.file.readDir).mockResolvedValue(null as any)
    vi.mocked(api.file.readFull).mockResolvedValue('needle here\nother line\n')

    const result = await toolExecutors.search_files({ path: 'src/a.ts', pattern: 'needle' }, ctx)

    expect(result.result).toContain('Found 1 matches')
    expect(result.result).not.toContain('showing the first')
  })

  it('目录搜索超上限时同样报告总数', async () => {
    vi.mocked(api.file.readDir).mockResolvedValue([] as any)
    vi.mocked(api.file.search).mockResolvedValue(
      Array.from({ length: 120 }, (_, index) => ({ path: `src/f${index}.ts`, line: 1, text: 'needle' })) as any
    )

    const result = await toolExecutors.search_files({ path: '.', pattern: 'needle' }, ctx)

    expect(result.result).toContain('Found 120 matches')
    expect(result.result).toContain('showing the first 50')
    expect(result.meta?.matchCount).toBe(120)
  })
})

describe('get_document_symbols 的降级阶梯', () => {
  it('大文件的结果始终可解析，且报告真实符号总数', async () => {
    vi.mocked(api.file.readFull).mockResolvedValue('source')
    vi.mocked(didOpenDocument).mockResolvedValue(true)
    vi.mocked(api.lsp.documentSymbol).mockResolvedValue(manySymbols(250, 3) as any)

    const result = await toolExecutors.get_document_symbols({
      relative_path: 'src/executors.ts',
      depth: 1,
    }, ctx)

    expect(result.success).toBe(true)
    expect(result.result.length).toBeLessThanOrEqual(10000)

    // 这是整个改动的核心断言：以前这里会被头尾切开变成语法残骸。
    const parsed = JSON.parse(result.result) as Record<string, any>
    expect(parsed.symbolCount).toBe(250)
    expect(parsed.truncated).toBe(true)
    expect(parsed.truncationNotice).toBeTruthy()
    expect(result.meta?.symbolCount).toBe(250)
  })

  it('小文件走第一级，没有降级标记', async () => {
    vi.mocked(api.file.readFull).mockResolvedValue('source')
    vi.mocked(didOpenDocument).mockResolvedValue(true)
    vi.mocked(api.lsp.documentSymbol).mockResolvedValue(manySymbols(3) as any)

    const result = await toolExecutors.get_document_symbols({ relative_path: 'src/small.ts' }, ctx)

    const parsed = JSON.parse(result.result) as Record<string, any>
    expect(parsed.symbols).toHaveLength(3)
    expect(parsed.truncated).toBeUndefined()
  })

  it('max_symbols 触顶时报告真实总数与返回数', async () => {
    vi.mocked(api.file.readFull).mockResolvedValue('source')
    vi.mocked(didOpenDocument).mockResolvedValue(true)
    vi.mocked(api.lsp.documentSymbol).mockResolvedValue(manySymbols(40) as any)

    const result = await toolExecutors.get_document_symbols({
      relative_path: 'src/mid.ts',
      max_symbols: 5,
    }, ctx)

    const parsed = JSON.parse(result.result) as Record<string, any>
    expect(parsed.symbolCount).toBe(40)
    expect(parsed.returnedCount).toBe(5)
    expect(parsed.truncationNotice).toContain('Showing 5 of 40')
  })
})

describe('find_symbol 的候选范围报告', () => {
  it('候选文件被裁剪且无命中时，区分「没有」和「没找完」', async () => {
    // 索引给出 80 个候选，上限 50 —— 剩下 30 个没搜。
    vi.mocked(api.index.searchSymbols).mockResolvedValue(
      Array.from({ length: 80 }, (_, index) => ({ relativePath: `src/f${index}.ts` })) as any
    )
    vi.mocked(api.file.readFull).mockResolvedValue('source')
    vi.mocked(didOpenDocument).mockResolvedValue(true)
    vi.mocked(api.lsp.documentSymbol).mockResolvedValue([] as any)

    const result = await toolExecutors.find_symbol({ name_path: 'missingSymbol' }, ctx)

    expect(result.success).toBe(true)
    expect(result.result).toContain('30 further candidates were not searched')
    expect(result.meta?.skippedFileCount).toBe(30)
  })

  it('候选未被裁剪且无命中时，直接说没有', async () => {
    vi.mocked(api.index.searchSymbols).mockResolvedValue([{ relativePath: 'src/a.ts' }] as any)
    vi.mocked(api.file.readFull).mockResolvedValue('source')
    vi.mocked(didOpenDocument).mockResolvedValue(true)
    vi.mocked(api.lsp.documentSymbol).mockResolvedValue([] as any)

    const result = await toolExecutors.find_symbol({ name_path: 'missingSymbol' }, ctx)

    expect(result.result).toBe('No matching symbols found')
    expect(result.meta?.skippedFileCount).toBe(0)
  })
})

describe('find_references 的限流', () => {
  it('只为要返回的引用解析所属符号', async () => {
    vi.mocked(api.file.readFull).mockResolvedValue('source')
    vi.mocked(didOpenDocument).mockResolvedValue(true)
    vi.mocked(api.lsp.documentSymbol).mockResolvedValue(manySymbols(1) as any)
    vi.mocked(api.lsp.references).mockResolvedValue(
      Array.from({ length: 30 }, (_, index) => ({
        uri: `file:///workspace/src/caller${index}.ts`,
        range: { start: { line: 0, character: 0 } },
      })) as any
    )

    const result = await toolExecutors.find_references({
      relative_path: 'src/a.ts',
      name_path: 'handler_0',
      max_references: 3,
    }, ctx)

    const parsed = JSON.parse(result.result) as Record<string, any>
    expect(parsed.referenceCount).toBe(30)
    expect(parsed.references).toHaveLength(3)
    expect(parsed.truncationNotice).toContain('Showing 3 of 30')

    // 源文件 1 次 + 3 个引用文件，而不是 1 + 30。
    expect(vi.mocked(api.lsp.documentSymbol).mock.calls).toHaveLength(4)
  })
})
