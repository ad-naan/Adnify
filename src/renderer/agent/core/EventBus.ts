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

/**
 * runLoop 结束的原因。
 *
 * 必须是闭集：以前这里是裸 `string`，于是消费方可以拿一个从来不会被 emit 的值
 * 去比较而编译器毫无反应。实际踩到两次：
 *   - planExecutor.ts 检查 'loop_detected' / 'max_iterations'
 *   - SubAgentManager.ts 检查 'failed'
 * 三个值都没有任何 emit 点，对应的分支是死代码，而真正会出现的 reason
 * （handoff_required / no_messages / waiting_for_user）落到了 else 里被当成成功。
 *
 * 新增 reason 时同步改这里，让所有 switch/比较点重新过一遍编译器。
 */
export type LoopEndReason =
  | 'complete'              // 正常跑完
  | 'error'                 // 循环内部报错
  | 'aborted'               // 被 abort（用户点停止 / 超时）
  | 'no_messages'           // 没有可发送的消息
  | 'handoff_required'      // 需要交接（上下文满 / 换模型）
  | 'tool_requested_stop'   // 工具显式要求停止
  | 'user_rejected'         // 用户拒绝了工具
  | 'waiting_for_user'      // 等用户回话（interactive 工具）

/**
 * 只有这些 reason 算「这一轮真的把活干完了」。
 *
 * 反过来列（而不是列失败项）是故意的：新增 reason 时默认落到「非成功」，
 * 而不是默默被当成成功回传给上层。以前 SubAgentManager / planExecutor 各自
 * 列举失败项，结果 handoff_required、no_messages、waiting_for_user 三种
 * 「没干完」的情况都被判成了成功。
 *
 * 注意 waiting_for_user 和 handoff_required 不在里面：前者是在等人回话，
 * 后者是需要交接，两者都没有可回传的最终结果。
 */
const SUCCESSFUL_LOOP_END_REASONS: ReadonlySet<LoopEndReason> = new Set<LoopEndReason>([
  'complete',
  'tool_requested_stop',
])

/** 这一轮是否算成功结束 */
export function isSuccessfulLoopEnd(reason: LoopEndReason): boolean {
  return SUCCESSFUL_LOOP_END_REASONS.has(reason)
}

/** 是否属于「被中止」——用户主动停、拒绝工具、或 abort 信号 */
export function isAbortedLoopEnd(reason: LoopEndReason): boolean {
  return reason === 'aborted' || reason === 'user_rejected'
}

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
  | { type: 'loop:end'; reason: LoopEndReason; threadId?: string; assistantId?: string; requestId?: string; planTaskId?: string }
  | { type: 'loop:warning'; message: string; threadId?: string; assistantId?: string; requestId?: string; planTaskId?: string }

  // 情绪感知事件
  //
  // 休息提醒和情绪文案都只走 `emotion:feedback`：状态栏和编辑器栏都订阅它，
  // 也是唯一带冷却/免打扰的通道。早先另有 `emotion:message`、`break:micro`、
  // `break:suggested` 三个事件，各自带一段中文句子，却没有任何订阅方。
  | { type: 'emotion:changed'; emotion: import('../types/emotion').EmotionDetection }
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
