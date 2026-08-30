/**
 * 消息队列 Hook
 * 监听 Agent 执行状态，在执行完成后自动消费队列中的下一条消息
 */

import { useEffect, useRef, useCallback } from 'react'
import { useMessageQueueStore } from '@/renderer/agent/store/slices/queueSlice'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { TURN_ACTIVE_PHASES } from '@/renderer/agent/types/thread'
import { useAgentCommands } from './useAgent'
import { useModeStore } from '@/renderer/modes/modeStore'

/**
 * 自动消费队列的 hook
 * 放在 ChatPanel 中使用，监听 streaming 状态变化
 * 
 * 修复：使用完整的 "busy" 判断（streaming | tool_running | tool_pending）
 * 确保从任何忙碌状态转为 idle 时都能触发队列消费
 */
export function useMessageQueueConsumer() {
  const { sendMessage } = useAgentCommands()

  // 这里要的是 TURN_ACTIVE_PHASES（含 tool_pending）而**不是** selectIsStreaming：
  // 等审批期间也算忙，否则队列会在人还没点批准的时候就把下一条消息塞进去。
  // 三个 phase 集合的分工见 types/thread.ts
  const isBusy = useAgentStore(state => {
    const threadId = state.currentThreadId
    if (!threadId) return false
    const phase = state.threads[threadId]?.streamState?.phase
    return phase !== undefined && TURN_ACTIVE_PHASES.has(phase)
  })

  const queue = useMessageQueueStore(s => s.queue)
  const dequeue = useMessageQueueStore(s => s.dequeue)
  const setMode = useModeStore(s => s.setMode)

  // 用 ref 追踪上一次的 busy 状态，检测从 busy → idle 的转换
  const wasBusyRef = useRef(false)
  const isConsumingRef = useRef(false)

  useEffect(() => {
    const wasBusy = wasBusyRef.current
    wasBusyRef.current = isBusy

    // 从 busy 变为 idle，且队列中有消息
    if (wasBusy && !isBusy && queue.length > 0 && !isConsumingRef.current) {
      isConsumingRef.current = true

      // 短暂延迟，让 UI 有时间更新
      const timer = setTimeout(async () => {
        const next = dequeue()
        if (next) {
          // 切换到消息对应的模式
          setMode(next.chatMode)
          // 发送消息
          try {
            await sendMessage(next.content, {
              mode: next.chatMode,
              threadId: next.targetThreadId,
              contextItems: next.contextItems,
            })
          } catch {
            // 发送失败不阻塞，错误已由 Agent 内部处理
          }
        }
        isConsumingRef.current = false
      }, 300)

      return () => {
        clearTimeout(timer)
        isConsumingRef.current = false
      }
    }
  }, [isBusy, queue.length, dequeue, sendMessage, setMode])
}

/**
 * 队列操作 hook
 * 提供入队、立即发送等操作
 */
export function useMessageQueueActions() {
  const enqueue = useMessageQueueStore(s => s.enqueue)
  const promote = useMessageQueueStore(s => s.promote)
  const { abort } = useAgentCommands()

  /**
   * 立即发送队列中的某条消息
   * 策略：将其提升到队首，等当前执行完成后自动发送
   */
  const sendNow = useCallback((id: string) => {
    promote(id)
  }, [promote])

  /**
   * 强制立即发送：中断当前执行 + 立即发送
   */
  const forceSendNow = useCallback(async (id: string) => {
    promote(id)
    abort()
    // abort 后 streaming 会变为 idle，useMessageQueueConsumer 会自动消费
  }, [promote, abort])

  return {
    enqueue,
    sendNow,
    forceSendNow,
  }
}
