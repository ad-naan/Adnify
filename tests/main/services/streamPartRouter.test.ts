/**
 * streamPartRouter 的单元测试。
 *
 * 这一层是 AI SDK 的流 part → 内部 StreamEvent 的纯翻译，以前内联在 processStream 的
 * 一个大 switch 里，一边翻译一边发事件、一边给六个累加器赋值，所以「翻译对不对」只
 * 能靠端到端测试间接观察。变成纯函数之后可以逐条钉住：事件、累加器增量、形态标记。
 *
 * 形态标记（sawToolActivity / sawExecutableToolCall / sawNonTextOutput）值得单独测：
 * StreamingService 用它们判定「空响应」和「说了 tool-calls 却没有可执行调用」，后者
 * 一旦误判就是 retryable 抛错 + 整条流重放——正是工具调用坏掉时的表现。
 */

import { describe, it, expect } from 'vitest'
import { routeStreamPart } from '@main/services/llm/services/streaming/streamPartRouter'
import { PseudoToolCallStreamAdapter } from '@main/services/llm/services/streaming/pseudoToolCallAdapter'
import type { ThinkingStrategy } from '@main/services/llm/strategies/ThinkingStrategy'

/** native 路由：不解析正文里的 thinking */
const nativeStrategy: ThinkingStrategy = {}

function deps(overrides: { strategy?: ThinkingStrategy; adapter?: PseudoToolCallStreamAdapter } = {}) {
  return {
    strategy: overrides.strategy ?? nativeStrategy,
    adapter: overrides.adapter ?? new PseudoToolCallStreamAdapter(false),
    requestId: 'req-1',
  }
}

describe('routeStreamPart', () => {
  it('生命周期 part 不产生任何输出', () => {
    for (const type of ['text-start', 'text-end', 'reasoning-start', 'reasoning-end', 'start', 'finish', 'raw', 'abort', 'start-step']) {
      const out = routeStreamPart({ type }, deps())
      expect(out.events).toEqual([])
      expect(out.textAppend).toBe('')
      expect(out.reasoningAppend).toBe('')
      expect(out.shape).toEqual({})
    }
  })

  it('text-delta 在 native 路由下原样变成 text 事件并计入正文', () => {
    const out = routeStreamPart({ type: 'text-delta', text: 'hello' }, deps())
    expect(out.events).toEqual([{ type: 'text', content: 'hello' }])
    expect(out.textAppend).toBe('hello')
  })

  it('空 text-delta 不发事件', () => {
    expect(routeStreamPart({ type: 'text-delta', text: '' }, deps()).events).toEqual([])
  })

  it('reasoning-delta 带出 Anthropic 的 thinking 签名', () => {
    const out = routeStreamPart({
      type: 'reasoning-delta',
      text: 'thinking...',
      providerMetadata: { anthropic: { signature: 'sig-abc' } },
    }, deps())

    expect(out.events).toEqual([{ type: 'reasoning', content: 'thinking...' }])
    expect(out.reasoningAppend).toBe('thinking...')
    expect(out.reasoningSignatureAppend).toBe('sig-abc')
  })

  it('xml-think 路由把正文里的 thinking 拆出来，只有剩下的算正文', () => {
    const strategy: ThinkingStrategy = {
      parseStreamText: () => ({ thinking: 'inner', content: 'visible' }),
    }
    const out = routeStreamPart({ type: 'text-delta', text: '<think>inner</think>visible' }, deps({ strategy }))

    // reasoning 必须排在 text 前面：渲染端按到达顺序放置推理块与正文
    expect(out.events).toEqual([
      { type: 'reasoning', content: 'inner' },
      { type: 'text', content: 'visible' },
    ])
    expect(out.reasoningAppend).toBe('inner')
    expect(out.textAppend).toBe('visible')
  })

  it('解析器只吐 thinking 时不发空正文', () => {
    const strategy: ThinkingStrategy = { parseStreamText: () => ({ thinking: 'only', content: '' }) }
    const out = routeStreamPart({ type: 'text-delta', text: '<think>only' }, deps({ strategy }))
    expect(out.events).toEqual([{ type: 'reasoning', content: 'only' }])
    expect(out.textAppend).toBe('')
  })

  it('原生工具调用四个 part 各自的事件与形态标记', () => {
    const start = routeStreamPart({ type: 'tool-input-start', id: 't1', toolName: 'read_file' }, deps())
    expect(start.events).toEqual([{ type: 'tool-call-start', id: 't1', name: 'read_file' }])
    expect(start.shape).toEqual({ sawToolActivity: true })

    const delta = routeStreamPart({ type: 'tool-input-delta', id: 't1', delta: '{"p"' }, deps())
    expect(delta.events).toEqual([{ type: 'tool-call-delta', id: 't1', argumentsDelta: '{"p"' }])
    expect(delta.shape).toEqual({ sawToolActivity: true })

    const end = routeStreamPart({ type: 'tool-input-end', id: 't1' }, deps())
    expect(end.events).toEqual([{ type: 'tool-call-delta-end', id: 't1' }])
    expect(end.shape).toEqual({ sawToolActivity: true })

    // 这一条是 finishReason === 'tool-calls' 校验的唯一依据
    const call = routeStreamPart({ type: 'tool-call', toolCallId: 't1', toolName: 'read_file', input: '{"path":"a"}' }, deps())
    expect(call.events).toEqual([
      { type: 'tool-call-available', id: 't1', name: 'read_file', arguments: { path: 'a' } },
    ])
    expect(call.shape).toEqual({ sawToolActivity: true, sawExecutableToolCall: true })
  })

  it('伪工具调用经适配器也产出 sawExecutableToolCall', () => {
    const adapter = new PseudoToolCallStreamAdapter(true)
    const out = routeStreamPart(
      { type: 'text-delta', text: '[{"name":"read_file","parameters":{"path":"a"}}]' },
      deps({ adapter }),
    )

    expect(out.textAppend).toBe('')
    expect(out.events.map(event => event.type)).toContain('tool-call-available')
    expect(out.shape).toEqual({ sawToolActivity: true, sawExecutableToolCall: true })
  })

  it('非正文输出只抬 sawNonTextOutput，不发事件', () => {
    for (const type of ['tool-result', 'tool-error', 'tool-output-denied', 'tool-approval-request', 'file', 'reasoning-file']) {
      const out = routeStreamPart({ type }, deps())
      expect(out.events).toEqual([])
      expect(out.shape).toEqual({ sawNonTextOutput: true })
    }
  })

  it('source: url 与非 url 两种形状分别翻译', () => {
    const url = routeStreamPart({ type: 'source', id: 's1', sourceType: 'url', url: 'https://x', title: 'X' }, deps())
    expect(url.events).toEqual([
      { type: 'source', source: { id: 's1', sourceType: 'url', url: 'https://x', title: 'X' } },
    ])
    expect(url.shape).toEqual({ sawNonTextOutput: true })

    const doc = routeStreamPart(
      { type: 'source', id: 's2', sourceType: 'document', mediaType: 'application/pdf', title: 'Doc', filename: 'a.pdf' },
      deps(),
    )
    expect(doc.events).toEqual([
      { type: 'source', source: { id: 's2', sourceType: 'document', mediaType: 'application/pdf', title: 'Doc', filename: 'a.pdf' } },
    ])
  })

  it('response-metadata 走主字段，finish-step 只当兜底', () => {
    const timestamp = new Date(0)
    const primary = routeStreamPart({ type: 'response-metadata', id: 'r1', modelId: 'm1', timestamp }, deps())
    expect(primary.responseMetadata).toEqual({ id: 'r1', modelId: 'm1', timestamp })
    expect(primary.responseMetadataFallback).toBeUndefined()

    const fallback = routeStreamPart({ type: 'finish-step', response: { id: 'r2', modelId: 'm2', timestamp } }, deps())
    expect(fallback.responseMetadata).toBeUndefined()
    expect(fallback.responseMetadataFallback).toEqual({ id: 'r2', modelId: 'm2', timestamp })
  })

  it('error part 只暂存错误，不发事件（由调用方在流结束后重抛）', () => {
    const real = new Error('boom')
    expect(routeStreamPart({ type: 'error', error: real }, deps()).error).toBe(real)
    expect(routeStreamPart({ type: 'error', error: 'plain' }, deps()).error).toEqual(new Error('plain'))
    expect(routeStreamPart({ type: 'error' }, deps()).error).toEqual(new Error('Unknown stream error'))
    expect(routeStreamPart({ type: 'error', error: real }, deps()).events).toEqual([])
  })

  it('未知 part 类型不产生输出（记日志，不静默改变累加器）', () => {
    const out = routeStreamPart({ type: 'some-future-part' }, deps())
    expect(out.events).toEqual([])
    expect(out.shape).toEqual({})
  })

  it('两次调用的返回值互不共享（events 数组不是同一个）', () => {
    const a = routeStreamPart({ type: 'start' }, deps())
    const b = routeStreamPart({ type: 'finish' }, deps())
    a.events.push({ type: 'text', content: 'leak' })
    a.shape.sawToolActivity = true
    expect(b.events).toEqual([])
    expect(b.shape).toEqual({})
  })
})
