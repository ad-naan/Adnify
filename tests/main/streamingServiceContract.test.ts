/**
 * 主进程流式路径的契约测试。
 *
 * ── 和 golden 测试的分工 ──
 * streamingServiceGolden.test.ts 绕过 streamText，直接驱动 processStream，钉的是
 * 「事件形状」。这里反过来：用真的 streamText 加 ai/test 的 MockLanguageModelV3，
 * 只 mock modelFactory，入口是 generate()。所以它覆盖的是 golden 覆盖不到的两段：
 *   1. AI SDK 的 part 名字。SDK 升级改了 part 命名，这里立刻炸，而 golden 不会——
 *      golden 里的 part 是我们自己写的字面量。
 *   2. generate() 外层的错误与重试编排（processStream 自己从不发 error 事件：
 *      流里的 error part 只是暂存后重抛，error 只由 generate 的 catch 和
 *      generateOnce 的 abort 分支发出）。
 *
 * 因此断言刻意粗：只看 `channel:type` 序列，不看载荷字面量。载荷是 golden 的活。
 *
 * ── 这里钉住了两个既有 bug，不要在这一步修 ──
 * 见下面两个 it 的注释。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  app: { getPath: () => '' },
}))

const modelState = vi.hoisted(() => ({
  model: null as unknown,
}))

// 只替换 createModel / resolveAuthForConfig 两个出口，其余（如
// resolveHeaderPlaceholders，被 RequestSettings 用到）保持真实实现。
vi.mock('@main/services/llm/modelFactory', async importOriginal => {
  const actual = await importOriginal<typeof import('@main/services/llm/modelFactory')>()
  return {
    ...actual,
    createModel: () => modelState.model,
    resolveAuthForConfig: async (config: unknown) => config,
  }
})

import { MockLanguageModelV3 } from 'ai/test'
import { convertArrayToReadableStream } from '@ai-sdk/provider-utils/test'
import { StreamingService } from '@main/services/llm/services/StreamingService'
import { forEachStreamChunk } from '@shared/utils/llmStreamBatch'
import type { LLMConfig, LLMMessage, ToolDefinition } from '@shared/types'

const REQUEST_ID = 'req-contract'

const CONFIG = {
  provider: 'openai',
  model: 'gpt-test',
  apiKey: 'k',
  protocol: 'openai',
} as unknown as LLMConfig

const MESSAGES: LLMMessage[] = [{ role: 'user', content: '你好' } as LLMMessage]

const READ_FILE_TOOL: ToolDefinition = {
  name: 'read_file',
  description: 'read a file',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
}

const V3_USAGE = { inputTokens: 5, outputTokens: 7, totalTokens: 12 }

/** MockLanguageModelV3 的 doStream 返回值 */
function streamOf(parts: unknown[]) {
  return { stream: convertArrayToReadableStream(parts as never[]) }
}

function harness() {
  const raw: Array<{ channel: string; payload: any }> = []

  const window = {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: unknown) => {
        raw.push({ channel, payload })
      },
    },
  } as unknown as import('electron').BrowserWindow

  const service = new StreamingService(window)

  /** 只看 `频道:类型`，不看载荷——载荷由 golden 测试负责 */
  const shape = () =>
    raw.flatMap(({ channel, payload }) => {
      const kind = channel.startsWith('llm:done')
        ? 'done'
        : channel.startsWith('llm:error')
          ? 'error'
          : 'stream'
      if (kind !== 'stream') return [`${kind}:-`]

      const out: string[] = []
      forEachStreamChunk(payload, chunk => out.push(`stream:${chunk.type}`))
      return out
    })

  return { service, shape, rawCount: () => raw.length }
}

describe('StreamingService.generate 与 AI SDK 的契约', () => {
  beforeEach(() => {
    modelState.model = null
  })

  it('纯文本响应：SDK 的 text-* part 翻成一条 stream:text，最后一条 done', async () => {
    modelState.model = new MockLanguageModelV3({
      doStream: async () =>
        streamOf([
          { type: 'stream-start', warnings: [] },
          { type: 'response-metadata', id: 'resp-1', modelId: 'gpt-test', timestamp: new Date(0) },
          { type: 'text-start', id: '0' },
          { type: 'text-delta', id: '0', delta: '你好' },
          { type: 'text-delta', id: '0', delta: '，世界' },
          { type: 'text-end', id: '0' },
          { type: 'finish', finishReason: 'stop', usage: V3_USAGE },
        ]),
    })

    const h = harness()
    const result = await h.service.generate({
      config: CONFIG,
      messages: MESSAGES,
      requestId: REQUEST_ID,
    })

    expect(result.content).toBe('你好，世界')
    expect(h.shape()).toEqual(['stream:text', 'stream:text', 'done:-'])
  })

  it('原生工具调用：SDK 的 tool-input-* / tool-call part 名字被钉住，正文先于工具边界', async () => {
    modelState.model = new MockLanguageModelV3({
      doStream: async () =>
        streamOf([
          { type: 'stream-start', warnings: [] },
          { type: 'response-metadata', id: 'resp-1', modelId: 'gpt-test', timestamp: new Date(0) },
          { type: 'text-start', id: '0' },
          { type: 'text-delta', id: '0', delta: '让我看看。' },
          { type: 'text-end', id: '0' },
          { type: 'tool-input-start', id: 'call-1', toolName: 'read_file' },
          { type: 'tool-input-delta', id: 'call-1', delta: '{"path":"a.ts"}' },
          { type: 'tool-input-end', id: 'call-1' },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'read_file',
            input: '{"path":"a.ts"}',
          },
          { type: 'finish', finishReason: 'tool-calls', usage: V3_USAGE },
        ]),
    })

    const h = harness()
    await h.service.generate({
      config: CONFIG,
      messages: MESSAGES,
      tools: [READ_FILE_TOOL],
      requestId: REQUEST_ID,
    })

    // text 必须在 tool_call_start 之前：这条不变量决定工具卡片渲染在正文之后。
    // 一旦工具边界事件被挪进合批通道，序列会变，而且工具会整个消失。
    expect(h.shape()).toEqual([
      'stream:text',
      'stream:tool_call_start',
      'stream:tool_call_delta',
      'stream:tool_call_delta_end',
      'stream:tool_call_available',
      'done:-',
    ])
  })

  it('【记录当前的 bug】流中报错会重放：渲染端收到两遍文字，没有 reset 事件把第一遍清掉', async () => {
    let attempts = 0
    modelState.model = new MockLanguageModelV3({
      doStream: async () => {
        attempts += 1
        return streamOf([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: '0' },
          { type: 'text-delta', id: '0', delta: `第${attempts}遍` },
          { type: 'error', error: new Error('provider exploded') },
          { type: 'finish', finishReason: 'error', usage: V3_USAGE },
        ])
      },
    })

    const h = harness()
    await expect(
      h.service.generate({ config: CONFIG, messages: MESSAGES, requestId: REQUEST_ID }),
    ).rejects.toThrow()

    // GenerationRecovery.ts:81 的缓存回退无条件重试第一次失败，与错误码无关，
    // 所以同一段流跑了两遍。线协议上没有「清空已发内容」的事件，渲染端只会
    // 把第二遍追加在第一遍后面。先钉住，修它是另一件事。
    expect(attempts).toBe(2)
    expect(h.shape()).toEqual(['stream:text', 'stream:text', 'error:-'])
  })

  it('【记录当前的 bug】abort 会发两条 llm:error（generateOnce 一条，generate 的 catch 再一条）', async () => {
    const controller = new AbortController()

    modelState.model = new MockLanguageModelV3({
      doStream: async () => {
        controller.abort()
        throw new Error('aborted by test')
      },
    })

    const h = harness()
    await expect(
      h.service.generate({
        config: CONFIG,
        messages: MESSAGES,
        requestId: REQUEST_ID,
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow()

    // 两条。今天渲染端只靠 stream.ts:300 的 isResolved 兜住第二条。
    expect(h.shape()).toEqual(['error:-', 'error:-'])
  })
})
