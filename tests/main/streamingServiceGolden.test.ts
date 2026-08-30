/**
 * 主进程流式路径的特征测试（golden test）。
 *
 * ── 为什么需要它 ──
 * 这条链路上同一个 IPC 载荷形状被声明了四遍，kebab→snake 的翻译靠两张手维护的
 * switch 加一个硬编码字符串数组协调，而 serializeEvent 的返回类型是 any 且带
 * `default: return event`，渲染端的 switch 又没有 default。于是「把某个事件从立即
 * 通道挪进合批通道」会让它以 kebab-case 上线并被静默丢弃——工具调用直接消失，而
 * 类型检查全绿。这种改动过去真的发生过，两轮纯静态审查都没能定位。
 *
 * 所以这里把「渲染端实际看到的事件序列」原样录下来。任何改动只要改变了这个序列，
 * 测试就会指着变化的那一条告诉你。
 *
 * ── 为什么这么驱动 ──
 * processStream 只读 result 的五个属性（stream / text / usage / finalStep /
 * finishReason），window 只用到 isDestroyed 和 webContents.send，所以不需要给
 * streamText 造 seam，也不需要真的 Electron：一个五属性的假 result 加一个记录数组
 * 的假 window 就够。processStream 是 private，用 cast 触达是有意的——这个测试的
 * 价值在于不改一行生产代码就能立起护栏。
 *
 * ── 断言分两层 ──
 * 先断 `channel:type` 序列（一眼能读，回归时直接指向病因），再断完整载荷字面量
 * （字段改名也会被抓到）。用内联字面量而不是 snapshot：全仓库零 snapshot 使用，
 * 而且线协议变更在 snapshot diff 里是不可见的，正好和这个测试的目的相反。
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  app: { getPath: () => '' },
}))

import { StreamingService } from '@main/services/llm/services/StreamingService'
import { ThinkingStrategyFactory } from '@main/services/llm/strategies/ThinkingStrategy'
import { forEachStreamChunk } from '@shared/utils/llmStreamBatch'

const REQUEST_ID = 'req-golden'

/** processStream 只 await 这四个 promise，其余属性从不被读 */
interface FakeResultTail {
  text: string
  usage: Record<string, unknown>
  finishReason: string
  responseId?: string
  modelId?: string
  timestamp?: Date
  providerMetadata?: Record<string, unknown>
}

/** 事件序列：数组（一次性吐完）或生成器工厂（可在中间插入假定时器等待） */
type PartSource = unknown[] | (() => AsyncGenerator<unknown>)

function fakeResult(parts: PartSource, tail: FakeResultTail) {
  return {
    stream:
      typeof parts === 'function'
        ? parts()
        : (async function* () {
            for (const part of parts) yield part
          })(),
    text: Promise.resolve(tail.text),
    usage: Promise.resolve(tail.usage),
    finalStep: Promise.resolve({
      providerMetadata: tail.providerMetadata,
      response: {
        id: tail.responseId ?? 'resp-1',
        modelId: tail.modelId ?? 'model-1',
        timestamp: tail.timestamp ?? new Date(0),
      },
    }),
    finishReason: Promise.resolve(tail.finishReason),
  }
}

/** 渲染端可见的一条事件：它落在哪个频道 + 拆批之后的载荷 */
interface Recorded {
  channel: 'stream' | 'done' | 'error'
  chunk: Record<string, unknown>
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

  const drive = (parts: PartSource, tail: FakeResultTail, enablePseudoToolAdapter = false) =>
    (service as any).processStream(
      fakeResult(parts, tail),
      ThinkingStrategyFactory.create('native'),
      REQUEST_ID,
      15_000,
      enablePseudoToolAdapter,
      undefined,
    )

  /** 用 preload 的同一个实现拆批，所以这就是渲染端真正看到的序列 */
  const recorded = (): Recorded[] =>
    raw.flatMap(({ channel, payload }) => {
      if (channel === `llm:done:${REQUEST_ID}`) return [{ channel: 'done' as const, chunk: payload }]
      if (channel === `llm:error:${REQUEST_ID}`) return [{ channel: 'error' as const, chunk: payload }]

      const out: Recorded[] = []
      forEachStreamChunk(payload, chunk => out.push({ channel: 'stream', chunk }))
      return out
    })

  const shape = () => recorded().map(r => `${r.channel}:${r.chunk.type ?? '-'}`)

  return { drive, recorded, shape, rawPayloads: () => raw }
}

const EMPTY_USAGE = { inputTokens: 10, outputTokens: 20, totalTokens: 30 }

/** done 载荷里 usage 的字段名和 TokenUsage 不同（sendEventImmediate 会重映射一次） */
const EXPECTED_DONE_USAGE = {
  promptTokens: 10,
  completionTokens: 20,
  totalTokens: 30,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: undefined,
  cacheReadSource: undefined,
  cacheWriteSource: undefined,
}

describe('StreamingService 主进程流式路径（golden）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('纯文本流：文字合批成一条 batch，done 单独走自己的频道', async () => {
    const h = harness()

    await h.drive(
      [
        { type: 'text-start' },
        { type: 'text-delta', text: 'Hello' },
        { type: 'text-delta', text: ' world' },
        { type: 'text-end' },
      ],
      { text: 'Hello world', usage: EMPTY_USAGE, finishReason: 'stop' },
    )

    expect(h.shape()).toEqual(['stream:text', 'stream:text', 'done:-'])

    expect(h.recorded()).toEqual([
      { channel: 'stream', chunk: { type: 'text', content: 'Hello' } },
      { channel: 'stream', chunk: { type: 'text', content: ' world' } },
      {
        channel: 'done',
        chunk: {
          reasoning: undefined,
          reasoningSignature: undefined,
          usage: EXPECTED_DONE_USAGE,
          metadata: {
            id: 'resp-1',
            modelId: 'model-1',
            timestamp: new Date(0),
            finishReason: 'stop',
          },
        },
      },
    ])
  })

  it('文本后跟原生工具调用：缓冲的文字必须先于工具边界事件送达，且全部是 snake_case', async () => {
    const h = harness()

    await h.drive(
      [
        { type: 'text-delta', text: '让我查一下。' },
        { type: 'tool-input-start', id: 'call-1', toolName: 'read_file' },
        { type: 'tool-input-delta', id: 'call-1', delta: '{"path":' },
        { type: 'tool-input-delta', id: 'call-1', delta: '"a.ts"}' },
        { type: 'tool-input-end', id: 'call-1' },
        { type: 'tool-call', toolCallId: 'call-1', toolName: 'read_file', input: { path: 'a.ts' } },
      ],
      { text: '让我查一下。', usage: EMPTY_USAGE, finishReason: 'tool-calls' },
    )

    // 关键顺序：text 在 tool_call_start 之前。tool_call_start 是立即事件，
    // 发它之前会强制冲刷缓冲区，这条不变量决定了工具卡片渲染在正文之后。
    expect(h.shape()).toEqual([
      'stream:text',
      'stream:tool_call_start',
      'stream:tool_call_delta',
      'stream:tool_call_delta',
      'stream:tool_call_delta_end',
      'stream:tool_call_available',
      'done:-',
    ])

    expect(h.recorded().slice(0, 6)).toEqual([
      { channel: 'stream', chunk: { type: 'text', content: '让我查一下。' } },
      { channel: 'stream', chunk: { type: 'tool_call_start', id: 'call-1', name: 'read_file' } },
      {
        channel: 'stream',
        chunk: { type: 'tool_call_delta', id: 'call-1', name: undefined, argumentsDelta: '{"path":' },
      },
      {
        channel: 'stream',
        chunk: { type: 'tool_call_delta', id: 'call-1', name: undefined, argumentsDelta: '"a.ts"}' },
      },
      { channel: 'stream', chunk: { type: 'tool_call_delta_end', id: 'call-1' } },
      {
        channel: 'stream',
        chunk: {
          type: 'tool_call_available',
          id: 'call-1',
          name: 'read_file',
          arguments: { path: 'a.ts' },
        },
      },
    ])
  })

  it('推理后跟工具调用：reasoning 与 text 同走合批，签名累加进 done', async () => {
    const h = harness()

    await h.drive(
      [
        {
          type: 'reasoning-delta',
          text: '先看文件。',
          providerMetadata: { anthropic: { signature: 'sig-a' } },
        },
        { type: 'reasoning-delta', text: '再决定。', providerMetadata: { anthropic: { signature: 'sig-b' } } },
        { type: 'text-delta', text: '好的。' },
        { type: 'tool-input-start', id: 'call-2', toolName: 'grep' },
        { type: 'tool-call', toolCallId: 'call-2', toolName: 'grep', input: { pattern: 'x' } },
      ],
      { text: '好的。', usage: EMPTY_USAGE, finishReason: 'tool-calls' },
    )

    expect(h.shape()).toEqual([
      'stream:reasoning',
      'stream:reasoning',
      'stream:text',
      'stream:tool_call_start',
      'stream:tool_call_available',
      'done:-',
    ])

    const done = h.recorded().at(-1)!
    expect(done.channel).toBe('done')
    expect(done.chunk.reasoning).toBe('先看文件。再决定。')
    expect(done.chunk.reasoningSignature).toBe('sig-asig-b')
  })

  it('source 事件走合批通道并保留 url 形态的字段', async () => {
    const h = harness()

    await h.drive(
      [
        { type: 'text-delta', text: '见参考。' },
        {
          type: 'source',
          id: 'src-1',
          sourceType: 'url',
          url: 'https://example.com',
          title: 'Example',
        },
      ],
      { text: '见参考。', usage: EMPTY_USAGE, finishReason: 'stop' },
    )

    expect(h.shape()).toEqual(['stream:text', 'stream:source', 'done:-'])
    expect(h.recorded()[1]).toEqual({
      channel: 'stream',
      chunk: {
        type: 'source',
        source: { id: 'src-1', sourceType: 'url', url: 'https://example.com', title: 'Example' },
      },
    })
  })

  it('finishReason 是 tool-calls 但没有可执行工具调用时抛可重试错误（这是「反复输出文字、工具永不执行」的机制）', async () => {
    const h = harness()

    await expect(
      h.drive(
        [
          { type: 'reasoning-delta', text: '想一下。' },
          { type: 'text-delta', text: '我要调用工具。' },
        ],
        { text: '我要调用工具。', usage: EMPTY_USAGE, finishReason: 'tool-calls' },
      ),
    ).rejects.toMatchObject({ code: 'LLM_NO_OUTPUT', retryable: true })

    // 抛错的那一刻缓冲区还没被冲刷：这条路径上没有任何立即事件（done 不会发），
    // 只剩一个 30ms 定时器悬着。
    expect(h.shape()).toEqual([])

    // 定时器照常到点，于是这批文字在异常抛出之后才到达渲染端。线上没有 reset
    // 事件，GenerationRecovery 又会重放整个流，所以渲染端会把重放的文字追加在
    // 这批后面——这就是「反复输出 think 和文字」看起来在累积的原因。
    // 同时这也钉住了 eventBuffer/flushTimers 在异常路径上不被清理（P2 要修）。
    await vi.advanceTimersByTimeAsync(30)
    expect(h.shape()).toEqual(['stream:reasoning', 'stream:text'])
  })

  it('完全空的响应抛 LLM_EMPTY_RESPONSE 且可重试', async () => {
    const h = harness()

    await expect(
      h.drive([{ type: 'start' }, { type: 'finish' }], {
        text: '',
        usage: EMPTY_USAGE,
        finishReason: 'stop',
      }),
    ).rejects.toMatchObject({ code: 'LLM_EMPTY_RESPONSE', retryable: true })

    expect(h.shape()).toEqual([])
  })

  it('流中的 error part 只暂存后重抛，processStream 自己从不发 error 事件', async () => {
    const h = harness()

    await expect(
      h.drive(
        [
          { type: 'text-delta', text: '部分内容' },
          { type: 'error', error: new Error('provider exploded') },
        ],
        { text: '部分内容', usage: EMPTY_USAGE, finishReason: 'error' },
      ),
    ).rejects.toThrow('provider exploded')

    // 没有 error:*。error 只由 generate() 的 catch 和 abort 分支发出。
    // 注意 text 停在缓冲区里没有被冲刷——只有立即事件才会触发冲刷。
    expect(h.shape()).toEqual([])
    expect(h.rawPayloads()).toEqual([])
  })
})

describe('StreamingService 的立即/合批分流', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('text/reasoning/tool_call_delta 走 batch 信封，工具边界与终止事件是裸载荷', async () => {
    const h = harness()

    await h.drive(
      [
        { type: 'text-delta', text: 'a' },
        { type: 'reasoning-delta', text: 'b' },
        { type: 'tool-input-delta', id: 'c1', delta: '{' },
        { type: 'tool-input-start', id: 'c1', toolName: 't' },
        { type: 'tool-call', toolCallId: 'c1', toolName: 't', input: {} },
      ],
      { text: 'a', usage: EMPTY_USAGE, finishReason: 'tool-calls' },
    )

    const envelopes = h.rawPayloads().map(({ channel, payload }) => ({
      channel: channel.split(':')[1],
      type: payload.type ?? '(bare)',
      batched: payload.type === 'batch' ? payload.events.map((e: any) => e.type) : undefined,
    }))

    expect(envelopes).toEqual([
      // 三个合批事件被 tool_call_start 的强制冲刷一次性发出
      { channel: 'stream', type: 'batch', batched: ['text', 'reasoning', 'tool_call_delta'], },
      { channel: 'stream', type: 'tool_call_start', batched: undefined },
      { channel: 'stream', type: 'tool_call_available', batched: undefined },
      { channel: 'done', type: '(bare)', batched: undefined },
    ])
  })

  it('【记录当前的 bug】sendEvent 是防抖不是节流：持续 token 流会被无限推迟到流结束', async () => {
    const h = harness()

    // 20ms 一个 token，比 30ms 的窗口短——这就是真实的持续输出。
    const parts = async function* () {
      for (const text of ['a', 'b', 'c', 'd', 'e']) {
        yield { type: 'text-delta', text }
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    }

    const pending = h.drive(parts, { text: 'abcde', usage: EMPTY_USAGE, finishReason: 'stop' })

    // 95ms：五个 token 都已产出，流还没结束（最后一次 sleep 到 100ms）。
    // 前沿节流下这时应该已经送出好几批；防抖下每次 append 都 clear 重排，
    // 定时器被推到了 110ms，所以一条都没送。
    await vi.advanceTimersByTimeAsync(95)
    expect(h.shape()).toEqual([])

    await vi.advanceTimersByTimeAsync(100)
    await pending

    // 直到 done（立即事件）强制冲刷，五个 token 才一次性到达渲染端——
    // 这正是「憋一大段然后蹦出来」。P2 换成前沿节流之后，上面那条断言会变成
    // 「已经分批送出」，届时必须有意识地更新这个 golden。
    expect(h.shape()).toEqual([
      'stream:text',
      'stream:text',
      'stream:text',
      'stream:text',
      'stream:text',
      'done:-',
    ])
  })
})
