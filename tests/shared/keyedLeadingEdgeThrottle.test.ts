/**
 * 前沿节流器的不变量测试。
 *
 * 这个模块存在的唯一理由是「防抖 vs 节流」这个坑在本仓库踩过两次（终端 PTY 输出、
 * LLM 流式事件），所以三条不变量必须逐条钉死，而不是靠调用点的集成测试间接覆盖。
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { createKeyedLeadingEdgeThrottle } from '@shared/utils/keyedLeadingEdgeThrottle'

interface Emitted {
  key: string
  payload: string
  at: number
}

function stringThrottle(intervalMs = 16) {
  const emitted: Emitted[] = []
  const throttle = createKeyedLeadingEdgeThrottle<string, string>({
    intervalMs,
    accumulate: (pending, next) => (pending ?? '') + next,
    emit: (key, payload) => emitted.push({ key, payload, at: Date.now() }),
  })

  return { throttle, emitted }
}

describe('createKeyedLeadingEdgeThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('不变量 1：首块零延迟送出，不等窗口', () => {
    const { throttle, emitted } = stringThrottle()

    throttle.push('a', 'hello')

    expect(emitted).toEqual([{ key: 'a', payload: 'hello', at: 0 }])
  })

  it('不变量 2：不是防抖——窗口不被后续 push 推迟，持续输出稳定按间隔出货', () => {
    const { throttle, emitted } = stringThrottle(16)

    // 每 4ms 一块，远快于窗口。防抖下除了首块什么都出不来。
    for (let i = 0; i < 12; i++) {
      throttle.push('a', String(i))
      vi.advanceTimersByTime(4)
    }

    // 第 i 块在 t=4i 送入。t=0 首块立即；之后每 16ms 一次窗口出货，且窗口到点先于
    // 同一毫秒的 push（advanceTimersByTime 先跑定时器），所以 '4' 落在第二窗而不是第一窗。
    expect(emitted).toEqual([
      { key: 'a', payload: '0', at: 0 },
      { key: 'a', payload: '123', at: 16 },
      { key: 'a', payload: '4567', at: 32 },
      { key: 'a', payload: '891011', at: 48 },
    ])
  })

  it('不变量 3：窗口内没有新数据就关掉窗口，停顿后的第一块又是零延迟', () => {
    const { throttle, emitted } = stringThrottle(16)

    throttle.push('a', 'first')
    expect(emitted).toHaveLength(1)

    // 空窗一轮，节流器应当把 key 摘掉
    vi.advanceTimersByTime(16)
    expect(throttle.size()).toBe(0)

    vi.advanceTimersByTime(1000)
    throttle.push('a', 'second')

    // 立即送出，而不是再等 16ms
    expect(emitted.at(-1)).toEqual({ key: 'a', payload: 'second', at: 1016 })
  })

  it('累加发生在窗口内：一次 emit 拿到的是这一窗合并后的载荷', () => {
    const { throttle, emitted } = stringThrottle(16)

    throttle.push('a', '1')
    throttle.push('a', '2')
    throttle.push('a', '3')

    expect(emitted).toEqual([{ key: 'a', payload: '1', at: 0 }])

    vi.advanceTimersByTime(16)
    expect(emitted.at(-1)).toEqual({ key: 'a', payload: '23', at: 16 })
  })

  it('按 key 各自独立计时，互不干扰', () => {
    const { throttle, emitted } = stringThrottle(16)

    throttle.push('a', 'a1')
    vi.advanceTimersByTime(8)
    throttle.push('b', 'b1')
    throttle.push('a', 'a2')
    throttle.push('b', 'b2')

    // 两个 key 的首块都立即送出，各自的窗口起点相差 8ms
    expect(emitted).toEqual([
      { key: 'a', payload: 'a1', at: 0 },
      { key: 'b', payload: 'b1', at: 8 },
    ])

    vi.advanceTimersByTime(8)
    expect(emitted.at(-1)).toEqual({ key: 'a', payload: 'a2', at: 16 })

    vi.advanceTimersByTime(8)
    expect(emitted.at(-1)).toEqual({ key: 'b', payload: 'b2', at: 24 })
  })

  it('flush 立即排空并关闭窗口，之后的第一块仍是零延迟（保证跨通道顺序）', () => {
    const { throttle, emitted } = stringThrottle(16)

    throttle.push('a', '1')
    throttle.push('a', '2')

    throttle.flush('a')
    expect(emitted.at(-1)).toEqual({ key: 'a', payload: '2', at: 0 })
    expect(throttle.hasPending('a')).toBe(false)
    expect(throttle.size()).toBe(0)

    // 被 flush 取消的定时器不会再补一次空 emit
    vi.advanceTimersByTime(100)
    expect(emitted).toHaveLength(2)

    throttle.push('a', '3')
    expect(emitted.at(-1)).toEqual({ key: 'a', payload: '3', at: 100 })
  })

  it('没有挂起数据时 flush 是 no-op，不会发空载荷', () => {
    const { throttle, emitted } = stringThrottle(16)

    throttle.flush('nobody')
    throttle.push('a', '1')
    throttle.flush('a')

    expect(emitted).toEqual([{ key: 'a', payload: '1', at: 0 }])
  })

  it('release 丢弃挂起数据且不 emit（abort 走这条）', () => {
    const { throttle, emitted } = stringThrottle(16)

    throttle.push('a', '1')
    throttle.push('a', '2')
    throttle.release('a')

    vi.advanceTimersByTime(100)
    expect(emitted).toEqual([{ key: 'a', payload: '1', at: 0 }])
    expect(throttle.size()).toBe(0)
  })

  it('releaseAll 清空全部 key，不留定时器（这是 abort 时不泄漏的依据）', () => {
    const { throttle, emitted } = stringThrottle(16)

    throttle.push('a', '1')
    throttle.push('b', '1')
    throttle.push('a', '2')
    throttle.push('b', '2')
    expect(throttle.size()).toBe(2)

    throttle.releaseAll()
    expect(throttle.size()).toBe(0)

    vi.advanceTimersByTime(100)
    expect(emitted).toHaveLength(2)
  })

  it('flushAll 排空所有 key', () => {
    const { throttle, emitted } = stringThrottle(16)

    throttle.push('a', '1')
    throttle.push('b', '1')
    throttle.push('a', '2')
    throttle.push('b', '2')

    throttle.flushAll()

    expect(emitted.slice(2)).toEqual([
      { key: 'a', payload: '2', at: 0 },
      { key: 'b', payload: '2', at: 0 },
    ])
    expect(throttle.size()).toBe(0)
  })

  it('emit 抛错不破坏节流器状态，错误交给 onEmitError', () => {
    const errors: unknown[] = []
    let shouldThrow = true

    const throttle = createKeyedLeadingEdgeThrottle<string, string>({
      intervalMs: 16,
      accumulate: (pending, next) => (pending ?? '') + next,
      emit: () => {
        if (shouldThrow) throw new Error('send failed')
      },
      onEmitError: error => errors.push(error),
    })

    throttle.push('a', '1')
    expect(errors).toHaveLength(1)

    // 状态没坏：窗口照常排定，后续数据照常累加与出货
    shouldThrow = false
    throttle.push('a', '2')
    expect(throttle.hasPending('a')).toBe(true)
    vi.advanceTimersByTime(16)
    expect(throttle.hasPending('a')).toBe(false)
  })

  it('accumulate 收到的 pending 在每次 emit 后复位为 undefined', () => {
    const seen: Array<string | undefined> = []

    const throttle = createKeyedLeadingEdgeThrottle<string, string>({
      intervalMs: 16,
      accumulate: (pending, next) => {
        seen.push(pending)
        return (pending ?? '') + next
      },
      emit: () => {},
    })

    throttle.push('a', '1')
    throttle.push('a', '2')
    throttle.push('a', '3')
    vi.advanceTimersByTime(16)
    throttle.push('a', '4')

    expect(seen).toEqual([undefined, undefined, '2', undefined])
  })

  it('支持非字符串载荷：数组 concat 是 LLM 事件流的用法', () => {
    const emitted: Array<{ key: string; payload: number[] }> = []
    const throttle = createKeyedLeadingEdgeThrottle<string, number[]>({
      intervalMs: 16,
      accumulate: (pending, next) => (pending ? [...pending, ...next] : next),
      emit: (key, payload) => emitted.push({ key, payload }),
    })

    throttle.push('req', [1])
    throttle.push('req', [2])
    throttle.push('req', [3, 4])
    vi.advanceTimersByTime(16)

    expect(emitted).toEqual([
      { key: 'req', payload: [1] },
      { key: 'req', payload: [2, 3, 4] },
    ])
  })
})
