/**
 * 改写线程 `messages` 时必须一起处理的两件事。
 *
 * 线程有一个运行期覆盖层 `liveAssistantMessage`：正在流式输出的那条助手消息
 * 存在这里而不在 `messages` 里，这样写 token 的成本与历史长度无关。
 * 代价是任何整体替换/截断 `messages` 的操作（回滚检查点、切分支、fork）
 * 都可能让覆盖层指向一条已经不存在的消息 —— 而这些入口都没有被
 * `isStreaming` 拦住，用户完全可以在流式输出中途点回滚。
 *
 * 留下悬空的覆盖层是硬故障：finalizeAssistant 找不到目标就无法收尾，
 * `streamState.phase` 永久停在 'streaming'，于是持久化订阅整个会话不再落盘，
 * 新消息全被塞进发送队列且永不消费。
 *
 * 另一件事是 `threadMessageVersions`：AgentStore 的消息投影在流式期间按版本号
 * 判断是否复用缓存，不 bump 就会继续渲染已经被截断掉的消息。
 */

import type { ChatMessage } from '../types/messages'
import type { ChatThread } from '../types/thread'

export function bumpThreadMessageVersion(
    versions: Record<string, number>,
    threadId: string
): Record<string, number> {
    return { ...versions, [threadId]: (versions[threadId] || 0) + 1 }
}

/**
 * 生成替换 `messages` 时的线程补丁：附带清理已经失效的流式覆盖层。
 *
 * 覆盖层的消息仍在新的 `messages` 里时保持原样（分支切换可能只是换了顺序），
 * 不在时连同 `streamState.phase` 一起收回 idle。
 */
export function withReplacedMessages(
    thread: ChatThread,
    messages: ChatMessage[]
): Pick<ChatThread, 'messages' | 'liveAssistantMessage' | 'streamState'> {
    const liveId = thread.liveAssistantMessage?.id
    const liveSurvives = liveId !== undefined && messages.some(message => message.id === liveId)
    if (liveId === undefined || liveSurvives) {
        return {
            messages,
            liveAssistantMessage: thread.liveAssistantMessage,
            streamState: thread.streamState,
        }
    }

    return {
        messages,
        liveAssistantMessage: undefined,
        streamState: { ...thread.streamState, phase: 'idle' },
    }
}
