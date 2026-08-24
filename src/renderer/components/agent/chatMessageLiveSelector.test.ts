/**
 * chatMessageLiveSelector 测试
 *
 * 核心断言是「引用稳定性」而不是取值正确性：卡顿的成因是 selector 每 33ms 返回
 * 新引用，导致 useShallow 判定变化、所有可见消息重渲染。所以这里主要用
 * toBe（引用相等）而不是 toEqual。
 */
import { describe, it, expect } from 'vitest'
import { selectLiveState, type LiveSelectorState } from './chatMessageLiveSelector'
import type { InteractiveContent } from '@renderer/agent/types/interactive'

const INTERACTIVE: InteractiveContent = {
  type: 'interactive',
  question: 'pick one',
  options: [{ id: 'a', label: 'A' }],
}

/** 造一个 store 快照；每次调用都新建 parts 数组，模拟不可变更新 */
function makeState(opts: {
  threadId?: string
  assistantId?: string
  phase?: string
  messageId?: string
  partsContent?: string
}): LiveSelectorState {
  const {
    threadId = 't1',
    assistantId = 'm1',
    phase = 'streaming',
    messageId = 'm1',
    partsContent = 'hello',
  } = opts
  return {
    currentThreadId: threadId,
    threads: {
      [threadId]: {
        streamState: { assistantId, phase },
        // 关键：每次调用都是全新数组，正是流式期间的真实情况
        messages: [
          {
            id: messageId,
            role: 'assistant',
            parts: [{ type: 'text', content: partsContent }],
            interactive: INTERACTIVE,
          },
        ],
      },
    },
  }
}

describe('selectLiveState — 引用稳定性（卡顿的根因）', () => {
  it('静态 assistant 消息：连续两次调用逐字段引用全等', () => {
    // 这是回归测试的核心。改之前 selector 无条件读 liveMessage.parts，
    // 每次都是新数组引用，useShallow 必然判定变化 → 重渲染。
    const s1 = makeState({ phase: 'idle', partsContent: 'a' })
    const s2 = makeState({ phase: 'idle', partsContent: 'b' })

    const r1 = selectLiveState(s1, 'm1', true, false)
    const r2 = selectLiveState(s2, 'm1', true, false)

    expect(r1.liveParts).toBe(r2.liveParts)
    expect(r1.liveInteractive).toBe(r2.liveInteractive)
    expect(r1.isStreaming).toBe(r2.isStreaming)
  })

  it('非 assistant 消息：结果引用恒定', () => {
    const r1 = selectLiveState(makeState({}), 'm1', false, false)
    const r2 = selectLiveState(makeState({ partsContent: 'changed' }), 'm1', false, false)

    expect(r1.liveParts).toBeUndefined()
    expect(r2.liveParts).toBeUndefined()
  })

  it('别的消息在流式时，本条静态消息不受影响', () => {
    // 12 条可见消息里只有 1 条在流式，其余 11 条必须完全不动
    const s1 = makeState({ assistantId: 'other', partsContent: 'x' })
    const s2 = makeState({ assistantId: 'other', partsContent: 'y' })

    const r1 = selectLiveState(s1, 'm1', true, true)
    const r2 = selectLiveState(s2, 'm1', true, true)

    expect(r1.isStreaming).toBe(false)
    expect(r1.liveParts).toBe(r2.liveParts) // 都是 undefined
  })

  it('phase 不在活跃集合内时不算流式', () => {
    for (const phase of ['idle', 'done', 'error', 'compressing']) {
      const r = selectLiveState(makeState({ phase }), 'm1', true, true)
      expect(r.isStreaming, `phase=${phase}`).toBe(false)
      expect(r.liveParts, `phase=${phase}`).toBeUndefined()
    }
  })
})

describe('selectLiveState — 流式中仍要拿到实时数据', () => {
  it('活跃流式消息返回 live parts', () => {
    const state = makeState({ phase: 'streaming', partsContent: 'live text' })
    const r = selectLiveState(state, 'm1', true, true)

    expect(r.isStreaming).toBe(true)
    expect(r.liveParts).toEqual([{ type: 'text', content: 'live text' }])
    expect(r.liveInteractive).toBe(INTERACTIVE)
  })

  it('流式期间 parts 变化必须被看到（不能过度缓存）', () => {
    // 修复不能走到另一个极端：正在流式的那条必须实时更新
    const r1 = selectLiveState(makeState({ partsContent: 'frame1' }), 'm1', true, true)
    const r2 = selectLiveState(makeState({ partsContent: 'frame2' }), 'm1', true, true)

    expect(r1.liveParts).not.toBe(r2.liveParts)
    expect(r2.liveParts).toEqual([{ type: 'text', content: 'frame2' }])
  })

  it('三种活跃 phase 都算流式', () => {
    for (const phase of ['streaming', 'tool_running', 'tool_pending']) {
      const r = selectLiveState(makeState({ phase }), 'm1', true, true)
      expect(r.isStreaming, `phase=${phase}`).toBe(true)
    }
  })

  it('message.isStreaming 为 false 时，即使 phase 活跃也不算', () => {
    const r = selectLiveState(makeState({ phase: 'streaming' }), 'm1', true, false)
    expect(r.isStreaming).toBe(false)
  })
})

describe('selectLiveState — 边界情况', () => {
  it('currentThreadId 为空', () => {
    const r = selectLiveState({ currentThreadId: null, threads: {} }, 'm1', true, true)
    expect(r.isStreaming).toBe(false)
    expect(r.liveParts).toBeUndefined()
  })

  it('thread 不存在', () => {
    const r = selectLiveState({ currentThreadId: 'missing', threads: {} }, 'm1', true, true)
    expect(r.isStreaming).toBe(false)
  })

  it('streamState 缺失时按 idle 处理', () => {
    const state: LiveSelectorState = {
      currentThreadId: 't1',
      threads: { t1: { messages: [] } },
    }
    expect(selectLiveState(state, 'm1', true, true).isStreaming).toBe(false)
  })

  it('流式中但 messages 里找不到该条：不抛错', () => {
    const state = makeState({ messageId: 'different' })
    const r = selectLiveState(state, 'm1', true, true)
    expect(r.isStreaming).toBe(true)
    expect(r.liveParts).toBeUndefined()
  })

  it('只匹配 role=assistant 的同 id 消息', () => {
    const state: LiveSelectorState = {
      currentThreadId: 't1',
      threads: {
        t1: {
          streamState: { assistantId: 'm1', phase: 'streaming' },
          messages: [
            { id: 'm1', role: 'user', parts: [{ type: 'text', content: 'wrong' }] },
            { id: 'm1', role: 'assistant', parts: [{ type: 'text', content: 'right' }] },
          ],
        },
      },
    }
    expect(selectLiveState(state, 'm1', true, true).liveParts).toEqual([{ type: 'text', content: 'right' }])
  })
})
