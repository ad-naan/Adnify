/**
 * AI SDK 流 part → 内部 StreamEvent 的纯翻译层。
 *
 * 为什么是纯函数：原来这段 switch 内联在 processStream 里，一边翻译一边
 * `this.sendEvent(...)`、一边给六个累加器赋值。于是「翻译对不对」只能靠端到端测试
 * 间接观察，而两处 text-delta 分支（自定义解析器 / 原生）把同一段逻辑抄了两遍，改
 * 一处忘一处不会有任何报错。现在它只做一件事：吃一个 part，返回要发的事件和累加器
 * 增量，调用方按顺序发出去。
 *
 * 事件顺序即返回数组顺序——这一点是有意义的：tool-call 事件必须排在同一 part 里
 * 产出的正文之前/之后的既有位置上，否则渲染端的工具卡片会插错地方。
 */

import { logger } from '@shared/utils/Logger'
import type { StreamEvent, ResponseMetadata } from '../../types'
import type { ThinkingStrategy } from '../../strategies/ThinkingStrategy'
import { normalizeToolCallArguments, type PseudoToolCallStreamAdapter } from './pseudoToolCallAdapter'

/** 「模型到底产出了什么形态的输出」——决定要不要判定为空响应 */
export interface StreamShapeFlags {
  /** 出现过任何工具调用相关事件（含只有 delta 没有最终调用的残缺情况） */
  sawToolActivity: boolean
  /** 出现过可执行的完整工具调用。finishReason 是 tool-calls 时这一条必须为真 */
  sawExecutableToolCall: boolean
  /** 出现过非正文输出（工具结果、附件、引用来源） */
  sawNonTextOutput: boolean
}

export interface StreamPartOutcome {
  /** 要按序发往渲染端的事件 */
  events: StreamEvent[]
  /** 追加到可见正文累加器（只统计适配器放行的部分） */
  textAppend: string
  /** 追加到 reasoning 累加器 */
  reasoningAppend: string
  /** 追加到 Anthropic thinking 签名累加器 */
  reasoningSignatureAppend: string
  /** 流内报告的响应元数据（每步都会来一次，后来的覆盖先来的） */
  responseMetadata?: ResponseMetadata
  /** 兜底元数据：只有在流里一次都没报过 response-metadata 时才采用 */
  responseMetadataFallback?: ResponseMetadata
  /** 流内错误：只暂存，由调用方在流结束后重抛 */
  error?: Error
  shape: Partial<StreamShapeFlags>
}

export interface StreamPartRouterDeps {
  strategy: ThinkingStrategy
  adapter: PseudoToolCallStreamAdapter
  requestId: string
}

/**
 * 每次都造一个新的空结果。
 *
 * 不用共享的 `EMPTY` 常量：那样所有「无输出」的 part 会共用同一个 `events` 数组和
 * 同一个 `shape` 对象，调用方只要往里 push 一次，后面每个 part 都会带上它。今天调用方
 * 只读不写所以不出事，但这是那种没有任何断言能提前发现的耦合。
 */
function outcome(partial: Partial<StreamPartOutcome> = {}): StreamPartOutcome {
  return {
    events: [],
    textAppend: '',
    reasoningAppend: '',
    reasoningSignatureAppend: '',
    shape: {},
    ...partial,
  }
}

/** 由事件类型推出形态标记，而不是在每个分支里手写一遍 */
function shapeOfEvents(events: StreamEvent[]): Partial<StreamShapeFlags> {
  const shape: Partial<StreamShapeFlags> = {}

  for (const event of events) {
    switch (event.type) {
      case 'tool-call-start':
      case 'tool-call-delta':
      case 'tool-call-delta-end':
        shape.sawToolActivity = true
        break
      case 'tool-call-available':
        shape.sawToolActivity = true
        shape.sawExecutableToolCall = true
        break
      default:
        break
    }
  }

  return shape
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function routeStreamPart(part: any, deps: StreamPartRouterDeps): StreamPartOutcome {
  const { strategy, adapter, requestId } = deps

  switch (part.type) {
    case 'text-start':
    case 'text-end':
    case 'reasoning-start':
    case 'reasoning-end':
    case 'start':
    case 'finish':
    case 'raw':
    case 'abort':
      return outcome()

    case 'start-step':
      if (part.warnings?.length > 0) {
        logger.llm.warn('[StreamPartRouter] Provider warnings', { requestId, warnings: part.warnings })
      }
      return outcome()

    case 'text-delta':
      return routeTextDelta(part.text, strategy, adapter)

    case 'reasoning-delta': {
      const events: StreamEvent[] = []
      if (part.text) {
        events.push({ type: 'reasoning', content: part.text })
      }
      return outcome({
        events,
        reasoningAppend: part.text || '',
        // Anthropic 把 thinking 块的签名放在 providerMetadata 里，重放时要原样带回去
        reasoningSignatureAppend: part.providerMetadata?.anthropic?.signature ?? '',
      })
    }

    case 'tool-input-start': {
      const events: StreamEvent[] = [{ type: 'tool-call-start', id: part.id, name: part.toolName }]
      return outcome({ events, shape: shapeOfEvents(events) })
    }

    case 'tool-input-delta': {
      const events: StreamEvent[] = [{
        type: 'tool-call-delta',
        id: part.id,
        argumentsDelta: part.delta,
      }]
      return outcome({ events, shape: shapeOfEvents(events) })
    }

    case 'tool-input-end': {
      const events: StreamEvent[] = [{ type: 'tool-call-delta-end', id: part.id }]
      return outcome({ events, shape: shapeOfEvents(events) })
    }

    case 'tool-call': {
      const events: StreamEvent[] = [{
        type: 'tool-call-available',
        id: part.toolCallId,
        name: part.toolName,
        arguments: normalizeToolCallArguments(part.input),
      }]
      return outcome({ events, shape: shapeOfEvents(events) })
    }

    case 'tool-result':
    case 'tool-error':
    case 'tool-output-denied':
    case 'tool-approval-request':
    case 'file':
    case 'reasoning-file':
      return outcome({ shape: { sawNonTextOutput: true } })

    case 'source':
      return outcome({
        shape: { sawNonTextOutput: true },
        events: [{
          type: 'source',
          source: {
            id: part.id,
            sourceType: part.sourceType,
            ...(part.sourceType === 'url'
              ? { url: part.url, title: part.title }
              : { mediaType: part.mediaType, title: part.title, filename: part.filename }),
          },
        }],
      })

    case 'response-metadata':
      return outcome({
        responseMetadata: { id: part.id, modelId: part.modelId, timestamp: part.timestamp },
      })

    case 'finish-step':
      return outcome({
        responseMetadataFallback: {
          id: part.response.id,
          modelId: part.response.modelId,
          timestamp: part.response.timestamp,
        },
      })

    case 'error':
      return outcome({
        error: part.error instanceof Error
          ? part.error
          : new Error(String(part.error ?? 'Unknown stream error')),
      })

    default:
      logger.llm.warn('[StreamPartRouter] Unhandled stream part type', { requestId, partType: part.type })
      return outcome()
  }
}

/**
 * 正文增量：先过 thinking 策略（只有 xml-think 这类把推理写在正文里的路由才有
 * parseStreamText），再过伪工具调用适配器。
 *
 * 原来这两条路径各自完整抄了一遍「遍历适配器事件 + 累加 visibleText」，其中自定义
 * 解析器那份在现有配置下是死代码（thinkingTagFormat 处处默认 'native'）。合成一条之后
 * 只有「要不要先跑解析器」这一个差别。
 */
function routeTextDelta(
  text: string,
  strategy: ThinkingStrategy,
  adapter: PseudoToolCallStreamAdapter,
): StreamPartOutcome {
  const events: StreamEvent[] = []
  let reasoningAppend = ''
  let visible = text

  if (strategy.parseStreamText) {
    const parsed = strategy.parseStreamText(text)
    if (parsed.thinking) {
      reasoningAppend = parsed.thinking
      events.push({ type: 'reasoning', content: parsed.thinking })
    }
    visible = parsed.content ?? ''
  }

  if (!visible) {
    return outcome({ events, reasoningAppend })
  }

  const adapted = adapter.consume(visible)
  events.push(...adapted.events)

  if (adapted.visibleText) {
    events.push({ type: 'text', content: adapted.visibleText })
  }

  return outcome({
    events,
    reasoningAppend,
    textAppend: adapted.visibleText,
    shape: shapeOfEvents(adapted.events),
  })
}
