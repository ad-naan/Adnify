/**
 * 消息队列 Store
 * 独立的 Zustand store，管理待发送消息的缓冲区
 * 在 Agent 执行期间缓存用户消息，执行完成后自动发送
 * 
 * 使用 persist 中间件将队列持久化到 sessionStorage，
 * 防止页面刷新或输出重启时队列丢失
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { MessageQueueSlice } from '../../types/queue'
import type { MessageContent } from '@shared/types'

export type { MessageQueueSlice }

export const useMessageQueueStore = create<MessageQueueSlice>()(
  persist(
    (set, get) => ({
      queue: [],

      enqueue: (msg) => {
        const id = crypto.randomUUID()
        const item = {
          id,
          content: msg.content,
          contextItems: [...msg.contextItems],
          chatMode: msg.chatMode,
          targetThreadId: msg.targetThreadId,
          createdAt: Date.now(),
          status: 'pending' as const,
        }
        set(state => ({ queue: [...state.queue, item] }))
        return id
      },

      dequeue: () => {
        const { queue } = get()
        if (queue.length === 0) return undefined
        const [first, ...rest] = queue
        set({ queue: rest })
        return first
      },

      peek: () => {
        const { queue } = get()
        return queue[0]
      },

      remove: (id) => {
        set(state => ({ queue: state.queue.filter(m => m.id !== id) }))
      },

      updateContent: (id, content: MessageContent) => {
        set(state => ({
          queue: state.queue.map(m => m.id === id ? { ...m, content } : m),
        }))
      },

      promote: (id) => {
        set(state => {
          const idx = state.queue.findIndex(m => m.id === id)
          if (idx <= 0) return state
          const item = state.queue[idx]
          const rest = state.queue.filter(m => m.id !== id)
          return { queue: [item, ...rest] }
        })
      },

      reorder: (fromIndex, toIndex) => {
        set(state => {
          const newQueue = [...state.queue]
          const [moved] = newQueue.splice(fromIndex, 1)
          if (moved) {
            newQueue.splice(toIndex, 0, moved)
          }
          return { queue: newQueue }
        })
      },

      clearQueue: () => {
        set({ queue: [] })
      },

      markSending: (id) => {
        set(state => ({
          queue: state.queue.map(m => m.id === id ? { ...m, status: 'sending' } : m),
        }))
      },
    }),
    {
      name: 'message-queue-storage',
      storage: createJSONStorage(() => sessionStorage),
      // 只持久化 queue 数据，不持久化方法
      partialize: (state) => ({ queue: state.queue }),
    }
  )
)
