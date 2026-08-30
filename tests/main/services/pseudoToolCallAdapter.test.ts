/**
 * 伪工具调用适配器的单元测试。
 *
 * 这个适配器以前内联在 StreamingService 里、未导出，只能通过整条流间接观察，所以它
 * 那条「进了 capturing 就永久吞掉所有正文」的路径一直没人发现。搬出来之后先把两类
 * 事实钉住：
 *   1. 普通正文必须原样透传，且探测阶段暂存的部分不能丢；
 *   2. 认错了要有回头路——超上限、以及流结束时都要把攒着的正文放回去。
 */

import { describe, it, expect } from 'vitest'
import {
  PseudoToolCallStreamAdapter,
  normalizeToolCallArguments,
  looksLikePseudoToolPayloadStart,
  tryParsePseudoToolPayload,
} from '@main/services/llm/services/streaming/pseudoToolCallAdapter'
import type { StreamEvent } from '@main/services/llm/types'

/** 把整段文本按固定长度切片喂进去，模拟 provider 的任意分块 */
function feed(adapter: PseudoToolCallStreamAdapter, text: string, chunkSize = 7) {
  let visible = ''
  const events: StreamEvent[] = []

  for (let i = 0; i < text.length; i += chunkSize) {
    const out = adapter.consume(text.slice(i, i + chunkSize))
    visible += out.visibleText
    events.push(...out.events)
  }

  const final = adapter.finalize()
  visible += final.visibleText
  events.push(...final.events)

  return { visible, events, types: events.map(event => event.type) }
}

describe('PseudoToolCallStreamAdapter', () => {
  it('disabled 时零开销直通', () => {
    const adapter = new PseudoToolCallStreamAdapter(false)
    expect(feed(adapter, '[{"name":"read_file","parameters":{"path":"a"}}]').visible)
      .toBe('[{"name":"read_file","parameters":{"path":"a"}}]')
  })

  it('普通正文原样透传，首个非 JSON 字符就放弃探测', () => {
    const adapter = new PseudoToolCallStreamAdapter(true)
    const { visible, events } = feed(adapter, 'Hello, this is a normal answer.')
    expect(visible).toBe('Hello, this is a normal answer.')
    expect(events).toEqual([])
  })

  it('以 { 开头但不是工具调用的正文也要完整放回', () => {
    const adapter = new PseudoToolCallStreamAdapter(true)
    const text = '{ "note": "this is JSON but not a tool call" }'
    expect(feed(adapter, text).visible).toBe(text)
  })

  it('JSON 数组形式转换成完整的 tool-call 事件序列', () => {
    const adapter = new PseudoToolCallStreamAdapter(true)
    const { visible, events, types } = feed(
      adapter,
      '[{"name":"read_file","parameters":{"path":"src/a.ts","limit":20}}]',
    )

    // 载荷本身不能作为正文露出去，否则界面上会和工具卡片重复
    expect(visible).toBe('')
    expect(types[0]).toBe('tool-call-start')
    expect(types.slice(-2)).toEqual(['tool-call-delta-end', 'tool-call-available'])
    expect(new Set(types.slice(1, -2))).toEqual(new Set(['tool-call-delta']))

    const available = events.at(-1)
    expect(available).toMatchObject({
      type: 'tool-call-available',
      name: 'read_file',
      arguments: { path: 'src/a.ts', limit: 20 },
    })

    // delta 拼起来就是完整的 parameters 对象
    const deltas = events
      .filter((event): event is Extract<StreamEvent, { type: 'tool-call-delta' }> => event.type === 'tool-call-delta')
      .map(event => event.argumentsDelta)
      .join('')
    expect(JSON.parse(deltas)).toEqual({ path: 'src/a.ts', limit: 20 })
    expect(adapter.hasCapturedToolCall()).toBe(true)
  })

  it('<tool_call> 标签形式同样被转换', () => {
    const adapter = new PseudoToolCallStreamAdapter(true)
    const { visible, events } = feed(
      adapter,
      '<tool_call>{"name":"list_dir","parameters":{"path":"."}}</tool_call>',
    )
    expect(visible).toBe('')
    expect(events.at(-1)).toMatchObject({ type: 'tool-call-available', name: 'list_dir', arguments: { path: '.' } })
  })

  it('进了 capturing 但工具名一直没出现，finalize 必须把攒着的正文放回来（回归：以前整段静默消失）', () => {
    const adapter = new PseudoToolCallStreamAdapter(true)
    // 两个键都在所以会进 capturing，但 name 的字符串值始终没写完，认不出工具名
    const text = '[{"parameters":{"a":1},"name":'
    const { visible, events } = feed(adapter, text)
    expect(visible).toBe(text)
    expect(events).toEqual([])
    expect(adapter.hasCapturedToolCall()).toBe(false)
  })

  it('capturing 吞过上限且没宣告过工具调用时，整段放回正文', () => {
    const adapter = new PseudoToolCallStreamAdapter(true)
    // "name" 的值本身是超长文本：能进 capturing，但 extractPseudoToolName 匹配不到闭合引号
    const text = `{"name":"${'x'.repeat(9000)}`
    const suffix = '","parameters":{}}'
    const first = adapter.consume(text)
    expect(first.visibleText.length).toBeGreaterThan(0)
    expect(first.events).toEqual([])

    // 放回之后进入 disabled，后续正文一律直通
    expect(adapter.consume(suffix).visibleText).toBe(suffix)
    expect(adapter.finalize().visibleText).toBe('')
  })

  it('宣告过 tool-call-start 之后，finalize 不再把载荷当正文放出来', () => {
    const adapter = new PseudoToolCallStreamAdapter(true)
    adapter.consume('[{"name":"read_file","parameters":{"path":')
    const final = adapter.finalize()
    expect(final.visibleText).toBe('')
    expect(adapter.hasCapturedToolCall()).toBe(true)
  })
})

describe('looksLikePseudoToolPayloadStart', () => {
  it('认出两种形状，拒绝普通正文', () => {
    expect(looksLikePseudoToolPayloadStart('<tool_call>{')).toBe('xml-tag')
    expect(looksLikePseudoToolPayloadStart('  [{"name":"a","parameters":{}')).toBe('json-array')
    expect(looksLikePseudoToolPayloadStart('{"name":"a"}')).toBeNull()
    expect(looksLikePseudoToolPayloadStart('hello')).toBeNull()
    expect(looksLikePseudoToolPayloadStart('')).toBeNull()
  })
})

describe('tryParsePseudoToolPayload', () => {
  it('对象、数组、标签三种包装都能解析', () => {
    expect(tryParsePseudoToolPayload('{"name":"a","parameters":{"x":1}}')).toEqual({ name: 'a', arguments: { x: 1 } })
    expect(tryParsePseudoToolPayload('[{"name":"a","parameters":{}}]')).toEqual({ name: 'a', arguments: {} })
    expect(tryParsePseudoToolPayload('<tool_call>{"name":"a","parameters":{}}</tool_call>'))
      .toEqual({ name: 'a', arguments: {} })
  })

  it('缺字段 / 类型不对 / 不完整都返回 null', () => {
    expect(tryParsePseudoToolPayload('{"name":"a"}')).toBeNull()
    expect(tryParsePseudoToolPayload('{"name":1,"parameters":{}}')).toBeNull()
    expect(tryParsePseudoToolPayload('{"name":"a","parameters":[]}')).toBeNull()
    expect(tryParsePseudoToolPayload('{"name":"a","parameters":{')).toBeNull()
  })
})

describe('normalizeToolCallArguments', () => {
  it('对象直通，JSON 字符串解析，坏载荷退化成空参数', () => {
    expect(normalizeToolCallArguments({ a: 1 })).toEqual({ a: 1 })
    expect(normalizeToolCallArguments('{"a":1}')).toEqual({ a: 1 })
    expect(normalizeToolCallArguments('not json')).toEqual({})
    expect(normalizeToolCallArguments('[1,2]')).toEqual({})
    expect(normalizeToolCallArguments(undefined)).toEqual({})
    expect(normalizeToolCallArguments('')).toEqual({})
  })
})
