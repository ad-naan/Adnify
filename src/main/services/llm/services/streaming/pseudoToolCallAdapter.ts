/**
 * 「伪工具调用」兼容适配器。
 *
 * 有些 provider（或被中转层削过的路由）不发原生 tool-call 事件，而是把工具调用当
 * 正文吐出来：`[{"name":"...","parameters":{...}}]` 或 `<tool_call>{...}</tool_call>`。
 * 这个适配器把那样的正文流**转换**成标准的 tool-call 事件序列，让下游（渲染端、
 * 工具执行器）只需要认识一种形状。
 *
 * ── 状态机 ──
 *   idle      → 还在探测：正文被暂存，不外发（否则会先漏出半个 JSON）
 *   capturing → 认定是伪工具调用：正文全部进 captureBuffer，逐步翻成 tool-call 事件
 *   disabled  → 认定是普通正文：此后原样透传，零开销
 *
 * 原来还有一个 `'probing'` 模式，全仓库从未被赋值——探测其实是 idle 干的。已删除。
 *
 * ── 为什么需要退出路径 ──
 * 以前一旦进 capturing 就没有回头路：如果这段 JSON 始终解析不成合法载荷（模型只是
 * 在写一段以 `{"name":` 开头的正文），captureBuffer 会一直吃下去，而 finalize() 返回
 * 空串——**整段正文静默消失**。现在有两条出口：超过上限且还没宣告过工具调用就整段
 * 放回正文；finalize 时同理。
 */

import { findJsonValueEnd } from '@shared/utils/jsonScan'
import { JSON_PAYLOAD_MARKUP_TAGS, markupOpenTag, markupCloseTag } from '@shared/utils/toolCallMarkup'
import type { StreamEvent } from '../../types'

/** 还没宣告工具调用时，capturing 最多吞多少字符就认输放回正文 */
const MAX_CAPTURE_CHARS = 8192

/** 探测阶段最多暂存多少字符还没认出形状，就判定是普通正文 */
const MAX_PROBE_CHARS = 256

const XML_OPEN = markupOpenTag(JSON_PAYLOAD_MARKUP_TAGS[0])
const XML_CLOSE = markupCloseTag(JSON_PAYLOAD_MARKUP_TAGS[0])

export interface PseudoToolCallPayload {
  name: string
  arguments: Record<string, unknown>
}

export interface AdapterOutput {
  visibleText: string
  events: StreamEvent[]
}

type PseudoToolCaptureMode = 'json-array' | 'xml-tag'

function createCompatToolCallId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `compat-tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function looksLikePseudoToolPayloadStart(text: string): PseudoToolCaptureMode | null {
  const trimmed = text.trimStart()
  if (!trimmed) return null
  if (trimmed.startsWith(XML_OPEN)) {
    return 'xml-tag'
  }

  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
    return null
  }

  const probe = trimmed.slice(0, MAX_PROBE_CHARS)
  if (/"name"\s*:/.test(probe) && /"parameters"\s*:/.test(probe)) {
    return 'json-array'
  }

  return null
}

export function tryParsePseudoToolPayload(text: string): PseudoToolCallPayload | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const payloadText = trimmed.startsWith(XML_OPEN) && trimmed.endsWith(XML_CLOSE)
    ? trimmed.slice(XML_OPEN.length, trimmed.length - XML_CLOSE.length).trim()
    : trimmed

  try {
    const parsed = JSON.parse(payloadText) as unknown
    const candidate = Array.isArray(parsed) ? parsed[0] : parsed
    if (!candidate || typeof candidate !== 'object') {
      return null
    }

    const name = (candidate as Record<string, unknown>).name
    const parameters = (candidate as Record<string, unknown>).parameters
    if (typeof name !== 'string' || !parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
      return null
    }

    return {
      name,
      arguments: parameters as Record<string, unknown>,
    }
  } catch {
    return null
  }
}

export function extractPseudoToolName(text: string): string | null {
  const match = text.match(/"name"\s*:\s*"([^"]+)"/)
  return match?.[1] ?? null
}

export function findParametersObjectStart(text: string): number {
  const keyMatch = /"parameters"\s*:/.exec(text)
  if (!keyMatch) return -1
  return text.indexOf('{', keyMatch.index + keyMatch[0].length)
}

/** provider 的 tool input 可能是对象也可能是 JSON 字符串，统一成对象 */
export function normalizeToolCallArguments(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>
  }

  if (typeof input !== 'string' || !input.trim()) {
    return {}
  }

  try {
    const parsed = JSON.parse(input) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // provider 载荷坏了就按空参数处理，不要让整条流挂掉
  }

  return {}
}

export class PseudoToolCallStreamAdapter {
  private mode: 'idle' | 'capturing' | 'disabled' = 'idle'
  private probeBuffer = ''
  private captureBuffer = ''
  private toolCallId: string | null = null
  private toolName: string | null = null
  private emittedArgumentChars = 0
  private started = false
  private completed = false

  constructor(private readonly enabled: boolean) {}

  consume(chunk: string): AdapterOutput {
    if (!this.enabled || !chunk || this.mode === 'disabled') {
      return { visibleText: chunk, events: [] }
    }

    if (this.mode === 'capturing') {
      return this.consumeCapturedChunk(chunk)
    }

    return this.probe(chunk)
  }

  hasCapturedToolCall(): boolean {
    return this.started
  }

  /**
   * 流结束时把还压在手里的正文放出来。
   *
   * capturing 且没能解析成载荷时也要放——以前这里返回空串，整段正文就没了。
   * 唯一不放的情况是已经宣告过 tool-call-start：那段文本就是工具调用的载荷本身，
   * 放出来会在界面上和工具卡片重复。
   */
  finalize(): AdapterOutput {
    if (this.mode === 'idle') {
      return { visibleText: this.takeProbeBuffer(), events: [] }
    }

    if (this.mode === 'capturing' && !this.completed) {
      const buffered = this.captureBuffer
      this.captureBuffer = ''
      this.mode = 'disabled'
      return { visibleText: this.started ? '' : buffered, events: [] }
    }

    return { visibleText: '', events: [] }
  }

  /** 探测阶段：暂存并判断这段正文是不是伪工具调用 */
  private probe(chunk: string): AdapterOutput {
    this.probeBuffer += chunk
    const trimmed = this.probeBuffer.trimStart()

    // 首个非空字符就不可能是 JSON / 标签开头：直接永久透传
    if (trimmed) {
      const firstChar = trimmed[0]
      if (firstChar !== '[' && firstChar !== '{' && firstChar !== '<') {
        return this.giveUpProbing()
      }
    }

    const detectedMode = looksLikePseudoToolPayloadStart(this.probeBuffer)
    if (detectedMode) {
      this.mode = 'capturing'
      this.captureBuffer = this.takeProbeBuffer()
      return this.consumeCapturedChunk('')
    }

    // 以 `<` 开头但不是 `<tool_call>` 的前缀
    const openPrefix = XML_OPEN.slice(0, Math.min(trimmed.length, XML_OPEN.length))
    if (trimmed.startsWith('<') && !openPrefix.startsWith(trimmed.slice(0, openPrefix.length))) {
      return this.giveUpProbing()
    }

    if (trimmed && this.probeBuffer.length >= MAX_PROBE_CHARS) {
      return this.giveUpProbing()
    }

    // 还看不出来，继续攒着——这段正文暂时不外发
    return { visibleText: '', events: [] }
  }

  private giveUpProbing(): AdapterOutput {
    this.mode = 'disabled'
    return { visibleText: this.takeProbeBuffer(), events: [] }
  }

  private takeProbeBuffer(): string {
    const buffered = this.probeBuffer
    this.probeBuffer = ''
    return buffered
  }

  private consumeCapturedChunk(chunk: string): AdapterOutput {
    if (chunk) {
      this.captureBuffer += chunk
    }

    const events: StreamEvent[] = []
    const name = extractPseudoToolName(this.captureBuffer)

    if (!this.started && name) {
      this.toolCallId = createCompatToolCallId()
      this.toolName = name
      this.started = true
      events.push({ type: 'tool-call-start', id: this.toolCallId, name })
    }

    if (this.started && this.toolCallId) {
      const delta = this.takeArgumentDelta()
      if (delta) {
        events.push({
          type: 'tool-call-delta',
          id: this.toolCallId,
          name: this.toolName ?? undefined,
          argumentsDelta: delta,
        })
      }
    }

    if (!this.completed) {
      const parsed = tryParsePseudoToolPayload(this.captureBuffer)
      if (parsed && this.toolCallId) {
        this.completed = true
        events.push({ type: 'tool-call-delta-end', id: this.toolCallId })
        events.push({
          type: 'tool-call-available',
          id: this.toolCallId,
          name: parsed.name,
          arguments: parsed.arguments,
        })
      }
    }

    // 退出路径：还没宣告过工具调用却已经吞了这么多，说明判断错了，整段放回正文
    if (!this.started && this.captureBuffer.length >= MAX_CAPTURE_CHARS) {
      const buffered = this.captureBuffer
      this.captureBuffer = ''
      this.mode = 'disabled'
      return { visibleText: buffered, events }
    }

    return { visibleText: '', events }
  }

  /** 取出 parameters 对象里尚未作为 delta 发出的那一段 */
  private takeArgumentDelta(): string {
    const paramStart = findParametersObjectStart(this.captureBuffer)
    if (paramStart < 0) return ''

    const paramEnd = findJsonValueEnd(this.captureBuffer, paramStart)
    const availableEnd = paramEnd >= 0 ? paramEnd + 1 : this.captureBuffer.length
    if (availableEnd <= paramStart + this.emittedArgumentChars) return ''

    const delta = this.captureBuffer.slice(paramStart + this.emittedArgumentChars, availableEnd)
    this.emittedArgumentChars += delta.length
    return delta
  }
}
