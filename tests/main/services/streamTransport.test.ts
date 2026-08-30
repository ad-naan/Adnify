/**
 * StreamTransport 的单元测试。
 *
 * 线协议与合批时序是这一层的全部职责，且它只需要 window 的两个方法，所以可以拿一个
 * 记录数组的假 window 完整驱动。golden 测试已经从 processStream 那头覆盖了信封拆分
 * 和 done 载荷，这里补它覆盖不到的三件事：release 丢弃挂起事件、window 销毁后不再
 * 外发、以及 serializeEvent 的逐字段翻译。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BrowserWindow } from 'electron'
import { StreamTransport, serializeEvent, STREAM_IPC_INTERVAL_MS } from '@main/services/llm/services/streaming/streamTransport'
import type { BufferedStreamEvent } from '@main/services/llm/types'

interface Sent { channel: string; payload: any }

function createFakeWindow() {
  const sent: Sent[] = []
  let destroyed = false

  const window = {
    isDestroyed: () => destroyed,
    webContents: {
      send: (channel: string, payload: unknown) => { sent.push({ channel, payload }) },
    },
  }

  return {
    window: window as unknown as BrowserWindow,
    sent,
    destroy: () => { destroyed = true },
  }
}

describe('StreamTransport', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('首块文本立即出货，同窗内的后续文本合并成一个信封', () => {
    const fake = createFakeWindow()
    const transport = new StreamTransport(fake.window)

    transport.send('r1', { type: 'text', content: 'a' })
    expect(fake.sent).toHaveLength(1)
    expect(fake.sent[0]).toEqual({
      channel: 'llm:stream:r1',
      payload: { type: 'batch', events: [{ type: 'text', content: 'a' }] },
    })

    transport.send('r1', { type: 'text', content: 'b' })
    transport.send('r1', { type: 'text', content: 'c' })
    expect(fake.sent).toHaveLength(1)

    vi.advanceTimersByTime(STREAM_IPC_INTERVAL_MS)
    expect(fake.sent[1].payload).toEqual({
      type: 'batch',
      events: [{ type: 'text', content: 'b' }, { type: 'text', content: 'c' }],
    })
  })

  it('立即事件先冲刷挂起的合批，保证工具卡片排在它前面的正文之后', () => {
    const fake = createFakeWindow()
    const transport = new StreamTransport(fake.window)

    transport.send('r1', { type: 'text', content: 'first' })   // 前沿：直接出去
    transport.send('r1', { type: 'text', content: 'pending' }) // 压在窗口里
    transport.send('r1', { type: 'tool-call-start', id: 't1', name: 'read_file' })

    expect(fake.sent.map(entry => entry.payload.type)).toEqual(['batch', 'batch', 'tool_call_start'])
    expect(fake.sent[1].payload.events).toEqual([{ type: 'text', content: 'pending' }])
    expect(fake.sent[2].payload).toEqual({ type: 'tool_call_start', id: 't1', name: 'read_file' })
  })

  it('per-request 通道互不影响', () => {
    const fake = createFakeWindow()
    const transport = new StreamTransport(fake.window)

    transport.send('r1', { type: 'text', content: 'one' })
    transport.send('r2', { type: 'text', content: 'two' })
    expect(fake.sent.map(entry => entry.channel)).toEqual(['llm:stream:r1', 'llm:stream:r2'])
  })

  it('release 丢弃挂起的合批事件（abort 走这条，不外发）', () => {
    const fake = createFakeWindow()
    const transport = new StreamTransport(fake.window)

    transport.send('r1', { type: 'text', content: 'shipped' })
    transport.send('r1', { type: 'text', content: 'dropped' })
    transport.release('r1')

    vi.advanceTimersByTime(STREAM_IPC_INTERVAL_MS * 4)
    expect(fake.sent).toHaveLength(1)
  })

  it('window 销毁后既不外发也不再排定窗口', () => {
    const fake = createFakeWindow()
    const transport = new StreamTransport(fake.window)

    transport.send('r1', { type: 'text', content: 'a' })
    transport.send('r1', { type: 'text', content: 'b' })
    fake.destroy()

    vi.advanceTimersByTime(STREAM_IPC_INTERVAL_MS * 4)
    expect(fake.sent).toHaveLength(1)
    expect(transport.isWindowDestroyed()).toBe(true)

    transport.send('r1', { type: 'text', content: 'c' })
    transport.send('r1', { type: 'done' })
    expect(fake.sent).toHaveLength(1)
  })

  it('done 的 usage 按渲染端的字段名逐个翻译', () => {
    const fake = createFakeWindow()
    const transport = new StreamTransport(fake.window)

    transport.send('r1', {
      type: 'done',
      reasoning: 'why',
      reasoningSignature: 'sig',
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        cachedInputTokens: 4,
        cacheWriteTokens: 5,
        reasoningTokens: 6,
        cacheReadSource: 'provider-reported',
        cacheWriteSource: 'provider-reported',
      },
      metadata: { id: 'm1', modelId: 'model', timestamp: new Date(0), finishReason: 'stop' },
    })

    expect(fake.sent[0]).toEqual({
      channel: 'llm:done:r1',
      payload: {
        reasoning: 'why',
        reasoningSignature: 'sig',
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
          cachedInputTokens: 4,
          cacheWriteTokens: 5,
          reasoningTokens: 6,
          cacheReadSource: 'provider-reported',
          cacheWriteSource: 'provider-reported',
        },
        metadata: { id: 'm1', modelId: 'model', timestamp: new Date(0), finishReason: 'stop' },
      },
    })
  })
})

describe('serializeEvent', () => {
  it('五种合批事件全部翻成 snake_case 线协议', () => {
    const cases: Array<[BufferedStreamEvent, unknown]> = [
      [{ type: 'text', content: 'a' }, { type: 'text', content: 'a' }],
      [{ type: 'reasoning', content: 'r' }, { type: 'reasoning', content: 'r' }],
      [
        { type: 'tool-call-delta', id: 't1', name: 'read_file', argumentsDelta: '{"p"' },
        { type: 'tool_call_delta', id: 't1', name: 'read_file', argumentsDelta: '{"p"' },
      ],
      [{ type: 'tool-call-delta-end', id: 't1' }, { type: 'tool_call_delta_end', id: 't1' }],
      [
        { type: 'source', source: { id: 's1', sourceType: 'url', url: 'https://x' } },
        { type: 'source', source: { id: 's1', sourceType: 'url', url: 'https://x' } },
      ],
    ]

    for (const [event, expected] of cases) {
      expect(serializeEvent(event)).toEqual(expected)
    }
  })
})
