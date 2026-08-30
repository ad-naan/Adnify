/**
 * 渲染端界面节奏的特征测试。
 *
 * StreamingBuffer 是「文字以多快的节奏出现在屏幕上」的唯一权威（主进程那侧只压 IPC
 * 频率上限）。三条不变量分开断言，因为它们会被不同的改动打破：
 *   1. 是节流不是防抖——持续 append 不会把已排定的 flush 无限推迟。这是主进程侧那个
 *      30ms 防抖 bug 的反面教材，必须防止回退。
 *   2. 前沿触发——首个 token 立刻落地，不吃一个 33ms 的首字延迟。
 *   3. 对齐绘制且有遮挡兜底——到点后在 rAF 里写 store；但窗口被遮挡时 rAF 不再触发，
 *      光等它文字会永久停住，所以必须有超时兜底。
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { streamingBuffer } from '@renderer/agent/store/StreamingBuffer'

interface TextFlush {
  messageId: string
  content: string
  threadId?: string
  at: number
}

function collect() {
  const text: TextFlush[] = []
  const reasoning: Array<{ messageId: string; partId: string; content: string; at: number }> = []

  streamingBuffer.setFlushCallback((messageId, content, threadId) => {
    text.push({ messageId, content, threadId, at: Date.now() })
  })
  streamingBuffer.setReasoningFlushCallback((messageId, partId, content) => {
    reasoning.push({ messageId, partId, content, at: Date.now() })
  })

  return { text, reasoning }
}

/**
 * 吃掉前沿那一次落地，让接下来的 append 落在节流窗口内。
 *
 * 缓冲此刻是空的，所以这次 flushNow 只有一个作用：把「上次落地时间」置成现在。
 */
function enterThrottledWindow() {
  streamingBuffer.flushNow()
}

describe('StreamingBuffer 的界面节奏', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    streamingBuffer.clear()
  })

  afterEach(() => {
    streamingBuffer.clear()
    vi.useRealTimers()
  })

  it('前沿触发：首个 token 立刻落地，不等一个 33ms 窗口', () => {
    const { text } = collect()

    streamingBuffer.append('m1', 'A')

    expect(text.map(f => f.content)).toEqual(['A'])
    expect(text[0].at).toBe(0)
  })

  it('是节流不是防抖：持续 append 不会把已排定的 flush 推迟', () => {
    const { text } = collect()

    // 每 10ms 来一个 token，比 33ms 的窗口短。防抖下永远不会 flush。
    for (let i = 0; i < 10; i++) {
      streamingBuffer.append('m1', String(i))
      vi.advanceTimersByTime(10)
    }

    // 首个 token 走前沿立刻落地，之后每满一个 33ms 窗口落地一次累积量
    expect(text.map(f => f.content)).toEqual(['0', '123', '456', '789'])
    expect(text.map(f => f.at)).toEqual([0, 33, 66, 99])
  })

  it('前沿之后的 token 要等满窗口，不会每个都触发一次落地', () => {
    const { text } = collect()

    streamingBuffer.append('m1', 'A')
    streamingBuffer.append('m1', 'B')
    vi.advanceTimersByTime(32)
    expect(text.map(f => f.content)).toEqual(['A'])

    vi.advanceTimersByTime(1)
    expect(text.map(f => f.content)).toEqual(['A', 'B'])
    expect(text[1].at).toBe(33)
  })

  it('文字与推理共用同一个时钟，一次 flush 同时排空两个通道', () => {
    const { text, reasoning } = collect()
    enterThrottledWindow()

    streamingBuffer.append('m1', '正文')
    streamingBuffer.appendReasoning('m1', 'p1', '想法', true)

    vi.advanceTimersByTime(33)

    expect(text.map(f => f.content)).toEqual(['正文'])
    expect(reasoning.map(f => f.content)).toEqual(['想法'])
    expect(text[0].at).toBe(reasoning[0].at)
  })

  it('按 messageId 与 partId 分桶累积，不同消息各自成一条回调', () => {
    const { text, reasoning } = collect()
    enterThrottledWindow()

    streamingBuffer.append('m1', 'a')
    streamingBuffer.append('m2', 'b')
    streamingBuffer.append('m1', 'c')
    streamingBuffer.appendReasoning('m1', 'p1', 'x', true)
    streamingBuffer.appendReasoning('m1', 'p2', 'y', true)

    vi.advanceTimersByTime(33)

    expect(text.map(f => [f.messageId, f.content])).toEqual([
      ['m1', 'ac'],
      ['m2', 'b'],
    ])
    expect(reasoning.map(f => [f.partId, f.content])).toEqual([
      ['p1', 'x'],
      ['p2', 'y'],
    ])
  })

  it('flushNow 取消挂起的定时器并立即排空（这是工具边界前「先落地正文」的机制）', () => {
    const { text } = collect()
    enterThrottledWindow()

    streamingBuffer.append('m1', 'a')
    expect(text).toEqual([])

    streamingBuffer.flushNow()
    expect(text.map(f => f.content)).toEqual(['a'])

    // 定时器已被取消，不会再补一次空 flush
    vi.advanceTimersByTime(100)
    expect(text).toHaveLength(1)
  })

  it('flushNow 是全局的：所有消息一起排空（关闭应用 / 收尾整条流走这条）', () => {
    const { text } = collect()
    enterThrottledWindow()

    streamingBuffer.append('m1', 'a')
    streamingBuffer.append('m2', 'b')

    streamingBuffer.flushNow()

    expect(text.map(f => f.messageId)).toEqual(['m1', 'm2'])
  })

  it('flushMessage 只排空目标消息，其余保持原节奏（这才是「改这条消息前先落地正文」要的语义）', () => {
    const { text, reasoning } = collect()
    enterThrottledWindow()

    streamingBuffer.append('m1', 'a')
    streamingBuffer.append('m2', 'b')
    streamingBuffer.appendReasoning('m1', 'p1', 'x', true)
    streamingBuffer.appendReasoning('m2', 'p2', 'y', true)

    streamingBuffer.flushMessage('m1')

    // m2 还压在缓冲里：以前这里走 flushNow()，另一个线程的 m2 会被一起写进 store
    expect(text.map(f => f.messageId)).toEqual(['m1'])
    expect(reasoning.map(f => f.messageId)).toEqual(['m1'])

    // 已排定的定时器没被动过，m2 照原节奏落地
    vi.advanceTimersByTime(33)
    expect(text.map(f => f.messageId)).toEqual(['m1', 'm2'])
    expect(reasoning.map(f => f.messageId)).toEqual(['m1', 'm2'])
  })

  it('flushMessage 排空过的消息不会在下一次 flush 里重复落地', () => {
    const { text } = collect()
    enterThrottledWindow()

    streamingBuffer.append('m1', 'a')
    streamingBuffer.flushMessage('m1')
    vi.advanceTimersByTime(100)

    expect(text.map(f => f.content)).toEqual(['a'])
  })

  it('clear 丢弃缓冲内容且不触发回调（abort / 切换会话走这条）', () => {
    const { text, reasoning } = collect()
    enterThrottledWindow()

    streamingBuffer.append('m1', 'a')
    streamingBuffer.appendReasoning('m1', 'p1', 'x', true)
    streamingBuffer.clear()

    vi.advanceTimersByTime(100)
    expect(text).toEqual([])
    expect(reasoning).toEqual([])
  })

  it('空字符串不入桶也不排定 flush', () => {
    const { text } = collect()

    streamingBuffer.append('m1', '')
    streamingBuffer.appendReasoning('m1', 'p1', '', true)

    vi.advanceTimersByTime(100)
    expect(text).toEqual([])
  })
})

/**
 * rAF 对齐与遮挡兜底。
 *
 * 单测跑在 node 上，本来没有 requestAnimationFrame（那条路径退化成同步落地）。这里显式
 * 注入一个可控的 rAF，才能断言「到点后是等下一帧写 store」以及「窗口被遮挡、帧回调永远
 * 不来时仍然会落地」。少了兜底，后台标签页里的整条流会永久停住。
 */
describe('StreamingBuffer 对齐绘制', () => {
  let frames: FrameRequestCallback[]
  let cancelled: number[]

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    frames = []
    cancelled = []
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      frames.push(cb)
      return frames.length
    }) as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = ((id: number) => {
      cancelled.push(id)
    }) as typeof cancelAnimationFrame
    streamingBuffer.clear()
  })

  afterEach(() => {
    streamingBuffer.clear()
    vi.useRealTimers()
    delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame
    delete (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame
  })

  it('到点后先请求一帧，在帧回调里才写 store', () => {
    const { text } = collect()

    streamingBuffer.append('m1', 'a')

    // 前沿这一次也走 rAF：还没落地，但帧已经排了
    expect(text).toEqual([])
    expect(frames).toHaveLength(1)

    frames[0](0)
    expect(text.map(f => f.content)).toEqual(['a'])

    // 帧回调已经落地了，兜底定时器不该再补一次
    vi.advanceTimersByTime(200)
    expect(text).toHaveLength(1)
  })

  it('窗口被遮挡（帧回调永不触发）时兜底定时器仍然落地，并撤掉挂起的帧', () => {
    const { text } = collect()

    streamingBuffer.append('m1', 'a')
    expect(frames).toHaveLength(1)

    vi.advanceTimersByTime(100)

    expect(text.map(f => f.content)).toEqual(['a'])
    expect(cancelled).toEqual([1])

    // 兜底落地之后节流状态是干净的：下一个 token 照常排下一次
    streamingBuffer.append('m1', 'b')
    vi.advanceTimersByTime(33)
    expect(frames).toHaveLength(2)
    frames[1](0)
    expect(text.map(f => f.content)).toEqual(['a', 'b'])
  })
})
