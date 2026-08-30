/**
 * 渲染端界面节奏的特征测试。
 *
 * StreamingBuffer 是「文字以多快的节奏出现在屏幕上」的唯一权威。它当前的行为和
 * 它自己的注释不一致（:4 说走 requestAnimationFrame 约 60fps，:91 说「第一次数据
 * 立即刷新」——两条都不成立），所以先把真实行为录下来，再在 P2 改。
 *
 * 三条不变量分开断言，因为它们会被不同的改动打破：
 *   1. 是节流不是防抖——持续 append 不会把 flush 无限推迟（这条今天是对的，
 *      也是主进程侧那个 bug 的反面教材，必须防止回退）。
 *   2. 首帧是否等待——今天等 33ms，这是可感知的首字延迟。
 *   3. 调度机制——今天是裸 setTimeout，没有对齐绘制，也没有页面被遮挡时的兜底。
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

  it('是节流不是防抖：持续 append 不会把已排定的 flush 推迟', () => {
    const { text } = collect()

    // 每 10ms 来一个 token，比 33ms 的窗口短。防抖下永远不会 flush。
    for (let i = 0; i < 10; i++) {
      streamingBuffer.append('m1', String(i))
      vi.advanceTimersByTime(10)
    }

    // 100ms 里刷了两次，而不是零次。窗口是从「上一次 flush 之后的第一个
    // append」起算的 33ms：第一次覆盖 t=0..30 的四个 token（t=33 落地），
    // 第二次从 t=40 重新起算（t=73 落地）。t=80 之后的 token 要等到 t=113。
    expect(text.map(f => f.content)).toEqual(['0123', '4567'])
    expect(text.map(f => f.at)).toEqual([33, 73])
  })

  it('【和注释不符】首个 token 不是立即刷新，要等满一个 33ms 窗口', () => {
    const { text } = collect()

    streamingBuffer.append('m1', 'A')

    vi.advanceTimersByTime(32)
    expect(text).toEqual([])

    vi.advanceTimersByTime(1)
    expect(text.map(f => f.content)).toEqual(['A'])
    // 首字延迟 33ms。前沿触发下这里应该是 0。
    expect(text[0].at).toBe(33)
  })

  it('文字与推理共用同一个时钟，一次 flush 同时排空两个通道', () => {
    const { text, reasoning } = collect()

    streamingBuffer.append('m1', '正文')
    streamingBuffer.appendReasoning('m1', 'p1', '想法', true)

    vi.advanceTimersByTime(33)

    expect(text.map(f => f.content)).toEqual(['正文'])
    expect(reasoning.map(f => f.content)).toEqual(['想法'])
    expect(text[0].at).toBe(reasoning[0].at)
  })

  it('按 messageId 与 partId 分桶累积，不同消息各自成一条回调', () => {
    const { text, reasoning } = collect()

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

    streamingBuffer.append('m1', 'a')
    streamingBuffer.flushNow()

    expect(text.map(f => f.content)).toEqual(['a'])
    expect(text[0].at).toBe(0)

    // 定时器已被取消，不会再补一次空 flush
    vi.advanceTimersByTime(100)
    expect(text).toHaveLength(1)
  })

  it('flushNow 是全局的：所有消息一起排空（关闭应用 / 收尾整条流走这条）', () => {
    const { text } = collect()

    streamingBuffer.append('m1', 'a')
    streamingBuffer.append('m2', 'b')

    streamingBuffer.flushNow()

    expect(text.map(f => f.messageId)).toEqual(['m1', 'm2'])
  })

  it('flushMessage 只排空目标消息，其余保持原节奏（这才是「改这条消息前先落地正文」要的语义）', () => {
    const { text, reasoning } = collect()

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

    streamingBuffer.append('m1', 'a')
    streamingBuffer.flushMessage('m1')
    vi.advanceTimersByTime(100)

    expect(text.map(f => f.content)).toEqual(['a'])
  })

  it('clear 丢弃缓冲内容且不触发回调（abort / 切换会话走这条）', () => {
    const { text, reasoning } = collect()

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
