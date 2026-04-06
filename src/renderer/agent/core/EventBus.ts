/**
 * 事件总线
 * 
 * 职责：
 * - 发布/订阅事件
 * - 解耦模块通信
 * - 连接 Store 更新
 */

import { logger } from '@utils/Logger'
import type { ToolCall } from '@/shared/types'
import type { HandoffDocument } from '../domains/context/types'
import type { TokenUsage } from '../types'

// ===== 事件类型 =====

export type AgentEvent =
  // 流式事件
  | { type: 'stream:text'; text: string }
  | { type: 'stream:reasoning'; text: string; phase: 'start' | 'delta' | 'end' }
  | { type: 'stream:tool_start'; id: string; name: string }
  | { type: 'stream:tool_delta'; id: string; args: string }
  | { type: 'stream:tool_available'; id: string; name: string; args: Record<string, unknown> }

  // LLM 事件
  | { type: 'llm:start' }
  | { type: 'llm:done'; content: string; toolCalls: ToolCall[]; usage?: TokenUsage }
  | { type: 'llm:error'; error: string }

  // 工具事件
  | { type: 'tool:pending'; id: string; name: string; args: Record<string, unknown>; threadId?: string; assistantId?: string; requestId?: string; toolCallId?: string }
  | { type: 'tool:running'; id: string; threadId?: string; assistantId?: string; requestId?: string; toolCallId?: string }
  | { type: 'tool:completed'; id: string; result: string; meta?: Record<string, unknown>; threadId?: string; assistantId?: string; requestId?: string; toolCallId?: string }
  | { type: 'tool:error'; id: string; error: string; threadId?: string; assistantId?: string; requestId?: string; toolCallId?: string }
  | { type: 'tool:rejected'; id: string; threadId?: string; assistantId?: string; requestId?: string; toolCallId?: string }

  // 上下文事件
  | { type: 'context:level'; level: number; tokens: number; ratio: number }
  | { type: 'context:warning'; level: number; message: string }  // 新增：上下文预警
  | { type: 'context:prune'; prunedCount: number; savedTokens: number }
  | { type: 'context:summary'; summary: string }
  | { type: 'context:handoff'; document: HandoffDocument }

  // 循环事件
  | { type: 'loop:start'; threadId?: string; assistantId?: string; requestId?: string; planTaskId?: string }
  | { type: 'loop:iteration'; count: number; threadId?: string; assistantId?: string; requestId?: string; planTaskId?: string }
  | { type: 'loop:end'; reason: string; threadId?: string; assistantId?: string; requestId?: string; planTaskId?: string }
  | { type: 'loop:warning'; message: string; threadId?: string; assistantId?: string; requestId?: string; planTaskId?: string }

  // 情绪感知事件
  | { type: 'emotion:changed'; emotion: import('../types/emotion').EmotionDetection }
  | { type: 'emotion:message'; message: string; state: import('../types/emotion').EmotionState }
  | { type: 'break:micro'; message: string }
  | { type: 'break:suggested'; message: string }
  | { type: 'emotion:feedback'; feedback: import('../types/emotion').EmotionFeedbackPayload }

  // Plan 执行事件
  | { type: 'plan:start'; planId: string; sessionId?: string }
  | { type: 'plan:complete'; planId: string; stats: import('../plan/types').ExecutionStats; sessionId?: string }
  | { type: 'plan:failed'; planId: string; error: string; sessionId?: string }
  | { type: 'plan:paused'; planId: string; sessionId?: string }
  | { type: 'plan:resumed'; planId: string; sessionId?: string }
  | { type: 'task:start'; taskId: string; planId: string; threadId?: string; assistantId?: string; requestId?: string }
  | { type: 'task:complete'; taskId: string; output: string; duration: number; threadId?: string; assistantId?: string; requestId?: string }
  | { type: 'task:failed'; taskId: string; error: string; threadId?: string; assistantId?: string; requestId?: string }

export type EventType = AgentEvent['type']

type EventHandler<T extends AgentEvent = AgentEvent> = (event: T) => void

// ===== EventBus 实现 =====

export class EventBusClass {
  private handlers = new Map<EventType, Set<EventHandler>>()
  private allHandlers = new Set<EventHandler>()

  /**
   * 订阅特定类型的事件
   */
  on<T extends EventType>(type: T, handler: EventHandler<Extract<AgentEvent, { type: T }>>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set())
    }
    this.handlers.get(type)!.add(handler as EventHandler)

    // 返回取消订阅函数
    return () => {
      this.handlers.get(type)?.delete(handler as EventHandler)
    }
  }

  /**
   * 订阅所有事件
   */
  onAll(handler: EventHandler): () => void {
    this.allHandlers.add(handler)
    return () => {
      this.allHandlers.delete(handler)
    }
  }

  /**
   * 发布事件
   */
  emit(event: AgentEvent): void {
    // 调用特定类型的处理器
    const handlers = this.handlers.get(event.type)
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event)
        } catch (error) {
          logger.agent.error(`[EventBus] Handler error for ${event.type}:`, error)
        }
      }
    }

    // 调用全局处理器
    for (const handler of this.allHandlers) {
      try {
        handler(event)
      } catch (error) {
        logger.agent.error(`[EventBus] Global handler error:`, error)
      }
    }
  }

  /**
   * 清除所有订阅
   */
  clear(): void {
    this.handlers.clear()
    this.allHandlers.clear()
  }

  /**
   * 清除特定类型的订阅
   */
  off(type: EventType): void {
    this.handlers.delete(type)
  }
}

export const EventBus = new EventBusClass()
