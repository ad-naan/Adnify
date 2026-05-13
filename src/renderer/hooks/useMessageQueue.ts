/**
 * 消息队列 Hook
 * 监听 Agent 执行状态，在执行完成后自动消费队列中的下一条消息
 */

import { useEffect, useRef, useCallback } from 'react'
import { useMessageQueueStore } from '@/renderer/agent/store/slices/queueSlice'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { useAgentCommands } from './useAgent'
import { useModeStore } from '@/renderer/modes/modeStore'

/**
 * 自动消费队列的 hook
 * 放在 ChatPanel 中使用，监听 streaming 状态变化
 */
export function useMessageQueueConsumer() {
  const { sendMessage } = useAgentCommands()
  const isStreaming = useAgentStore(state => {
    const threadId = state.currentThreadId
    if (!threadId) return false
    const thread = state.threads[threadId]
    return thread?.streamState?.phase === 'streaming'
  })

  const queue = useMessageQueueStore(s => s.queue)
  const dequeue = useMessageQueueStore(s => s.dequeue)
  const setMode = useModeStore(s => s.setMode)

  // 用 ref 追踪上一次的 streaming 状态，检测从 streaming → idle 的转换
  const wasStreamingRef = useRef(false)
  const isConsumingRef = useRef(false)

  useEffect(() => {
    const wasStreaming = wasStreamingRef.current
    wasStreamingRef.current = isStreaming

    // 从 streaming 变为 idle，且队列中有消息
    if (wasStreaming && !isStreaming && queue.length > 0 && !isConsumingRef.current) {
      isConsumingRef.current = true

      // 短暂延迟，让 UI 有时间更新
      const timer = setTimeout(async () => {
        const next = dequeue()
        if (next) {
          // 切换到消息对应的模式
          setMode(next.chatMode)
          // 发送消息
          try {
            await sendMessage(next.content)
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
  }, [isStreaming, queue.length, dequeue, sendMessage, setMode])
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
