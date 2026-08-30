/**
 * 流式事件的传输层：window / per-request 通道 / 合批节流 / 立即-vs-合批分流。
 *
 * 从 StreamingService 里切出来的原因很直接：这一层的正确性完全由「线协议 + 时序」
 * 决定，和「怎么读模型流」无关。分开之后它可以拿一个假 window 完整测试
 * （tests/main/streamingServiceGolden.test.ts 就是这么驱动的）。
 *
 * 两条通道的划分见 ../../types.ts 的 IMMEDIATE_STREAM_EVENT_TYPES：
 *   立即通道——载荷由 sendEventImmediate 手写，发送前强制冲刷合批缓冲，保证
 *             「工具卡片出现在它前面的正文之后」；
 *   合批通道——载荷由 serializeEvent 从 kebab-case 翻成 snake_case 线协议。
 * 两侧的形参类型都由那个常量派生，所以挪动任何一个事件都会在这里编译报错。
 */

import type { BrowserWindow } from 'electron'
import { logger } from '@shared/utils/Logger'
import { createKeyedLeadingEdgeThrottle } from '@shared/utils/keyedLeadingEdgeThrottle'
import { isImmediateStreamEvent } from '../../types'
import type { StreamEvent, BufferedStreamEvent, ImmediateStreamEvent } from '../../types'
import type { RendererStreamChunk } from '@shared/types'

/**
 * IPC 合批的出货间隔上限。
 *
 * 这里只负责「IPC 频率上限」，不负责界面节奏——界面节奏的唯一权威是渲染端的
 * StreamingBuffer（33ms、对齐 rAF）。所以这个值要明显小于 33ms，否则主进程就成了
 * 那条更慢的链，渲染端再怎么对齐绘制也匀不出来。
 */
export const STREAM_IPC_INTERVAL_MS = 16

export class StreamTransport {
  /**
   * 按 requestId 分组的 IPC 合批节流器（只装合批事件——立即事件永远不进这里）。
   *
   * 以前这里是 eventBuffer + flushTimers 两张表加一段 30ms 的**防抖**（每次 append
   * 都 clearTimeout 重排），持续 token 流会把出货时机无限推迟，表现为「憋一大段然后
   * 蹦出来」。换成前沿节流之后：首块零延迟，之后按 16ms 稳定出货。
   *
   * 顺带解决了条目泄漏：以前只有冲刷路径会删表项，abort / 异常路径留着空条目；
   * 现在空窗一轮节流器自己就把 key 摘掉了。
   */
  private readonly pacer = createKeyedLeadingEdgeThrottle<string, BufferedStreamEvent[]>({
    intervalMs: STREAM_IPC_INTERVAL_MS,
    accumulate: (pending, next) => (pending ? [...pending, ...next] : next),
    emit: (requestId, events) => this.sendBatch(requestId, events),
    onEmitError: (error, requestId) => {
      logger.llm.error('[StreamTransport] Failed to flush events:', { requestId, error })
    },
  })

  constructor(private readonly window: BrowserWindow) {}

  isWindowDestroyed(): boolean {
    return this.window.isDestroyed()
  }

  send(requestId: string, event: StreamEvent): void {
    if (this.window.isDestroyed()) return

    if (isImmediateStreamEvent(event)) {
      this.pacer.flush(requestId)
      this.sendImmediate(requestId, event)
      return
    }

    this.pacer.push(requestId, [event])
  }

  /** 丢弃该请求挂起的合批事件（abort / 关闭走这条，不外发） */
  release(requestId: string): void {
    this.pacer.release(requestId)
  }

  /** 把一窗合并后的事件作为一个 batch 信封送出。渲染端由 forEachStreamChunk 统一拆批 */
  private sendBatch(requestId: string, events: BufferedStreamEvent[]): void {
    if (events.length === 0) return

    if (this.window.isDestroyed()) {
      this.pacer.release(requestId)
      return
    }

    this.window.webContents.send(`llm:stream:${requestId}`, {
      type: 'batch',
      events: events.map(event => serializeEvent(event)),
    })
  }

  private sendImmediate(requestId: string, event: ImmediateStreamEvent): void {
    try {
      switch (event.type) {
        case 'tool-call-start':
          this.window.webContents.send(`llm:stream:${requestId}`, {
            type: 'tool_call_start',
            id: event.id,
            name: event.name,
          })
          break

        case 'tool-call-available':
          this.window.webContents.send(`llm:stream:${requestId}`, {
            type: 'tool_call_available',
            id: event.id,
            name: event.name,
            arguments: event.arguments,
          })
          break

        case 'error':
          this.window.webContents.send(`llm:error:${requestId}`, {
            message: event.error.message,
            code: event.error.code,
            retryable: event.error.retryable,
          })
          break

        case 'done':
          logger.llm.info('[StreamTransport] Sending done event', { requestId, channel: `llm:done:${requestId}` })
          this.window.webContents.send(`llm:done:${requestId}`, {
            reasoning: event.reasoning,
            reasoningSignature: event.reasoningSignature,
            usage: event.usage ? {
              promptTokens: event.usage.inputTokens,
              completionTokens: event.usage.outputTokens,
              totalTokens: event.usage.totalTokens,
              cachedInputTokens: event.usage.cachedInputTokens,
              cacheWriteTokens: event.usage.cacheWriteTokens,
              reasoningTokens: event.usage.reasoningTokens,
              cacheReadSource: event.usage.cacheReadSource,
              cacheWriteSource: event.usage.cacheWriteSource,
            } : undefined,
            metadata: event.metadata,
          })
          break
      }
    } catch (error) {
      logger.llm.error('[StreamTransport] Failed to send event:', error)
    }
  }
}

/**
 * kebab-case 的内部事件翻成渲染端的 snake_case 线协议。
 *
 * 返回类型是 RendererStreamChunk 而不是 any，入参是 BufferedStreamEvent 而不是
 * StreamEvent，所以这个 switch 必须穷尽——原来的 `default: return event` 会把未翻译
 * 的事件原样上线（kebab-case），而渲染端的 switch 没有 default，结果是静默丢弃。
 * 现在少写一个 case 就是编译错误。
 */
export function serializeEvent(event: BufferedStreamEvent): RendererStreamChunk {
  switch (event.type) {
    case 'text':
      return { type: 'text', content: event.content }
    case 'reasoning':
      return { type: 'reasoning', content: event.content }
    case 'tool-call-delta':
      return {
        type: 'tool_call_delta',
        id: event.id,
        name: event.name,
        argumentsDelta: event.argumentsDelta,
      }
    case 'tool-call-delta-end':
      return { type: 'tool_call_delta_end', id: event.id }
    case 'source':
      return { type: 'source', source: event.source }
  }
}
