/**
 * 消息队列类型定义
 * 用于在 Agent 执行期间缓存用户消息，执行完成后自动发送
 */

import type { ContextItem } from '../types'
import type { WorkMode } from '@/renderer/modes/types'
import type { MessageContent } from '@shared/types'

export interface QueuedMessage {
  /** 唯一标识 */
  id: string
  /** 消息内容（文本或多模态） */
  content: MessageContent
  /** 附带的上下文项 */
  contextItems: ContextItem[]
  /** 工作模式 */
  chatMode: WorkMode
  /** 入队时间 */
  createdAt: number
  /** 状态 */
  status: 'pending' | 'sending'
}

export interface MessageQueueState {
  /** 队列中的消息列表 */
  queue: QueuedMessage[]
}

export interface MessageQueueActions {
  /** 入队 */
  enqueue: (msg: Pick<QueuedMessage, 'content' | 'contextItems' | 'chatMode'>) => string
  /** 出队（取第一条） */
  dequeue: () => QueuedMessage | undefined
  /** 查看队首（不移除） */
  peek: () => QueuedMessage | undefined
  /** 移除指定消息 */
  remove: (id: string) => void
  /** 编辑消息内容 */
  updateContent: (id: string, content: MessageContent) => void
  /** 移动到队首（立即发送） */
  promote: (id: string) => void
  /** 重新排序 */
  reorder: (fromIndex: number, toIndex: number) => void
  /** 清空队列 */
  clearQueue: () => void
  /** 标记为发送中 */
  markSending: (id: string) => void
}

export type MessageQueueSlice = MessageQueueState & MessageQueueActions
