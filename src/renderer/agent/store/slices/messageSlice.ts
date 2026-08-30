/**
 * 消息管理 Slice
 * 负责消息的添加、更新、删除
 */

import type { StateCreator } from 'zustand'
import type {
    ChatMessage,
    UserMessage,
    AssistantMessage,
    ToolResultMessage,
    CheckpointMessage,
    MessageContent,
    ContextItem,
    ToolCall,
    ToolResultType,
    FileSnapshot,
    AssistantPart,
    ReasoningPart,
    SearchPart,
    SourcesPart,
    InteractiveContent,
    ChatThread,
} from '../../types'
import type { LLMStreamSource } from '@/shared/types/llm'
import { createIdleHandoffState, materializeThreadMessages } from '../../types'
import { streamingBuffer } from '../StreamingBuffer'
import type { ThreadSlice } from './threadSlice'
import type { BranchSlice } from './branchSlice'
import type { StreamFlushSlice } from './streamFlushSlice'
import { mutateAssistantRow } from './assistantRowMutation'
import { useStore } from '@/renderer/store'
import { t } from '@/renderer/i18n'
import { buildPersistedAgentSessionState, persistCriticalAgentSessionState } from '../agentStorage'
import { bumpThreadMessageVersion } from '../threadMessages'
import { getAgentConfig } from '../../utils/AgentConfig'

// ===== 类型定义 =====

export interface ToolExecutionStreamContext {
    requestId?: string
    assistantId?: string
}

export interface ToolExecutionResultRecord {
    name: string
    content: string
    type: ToolResultType
    rawParams?: Record<string, unknown>
}

export interface MessageActions {
    // 消息操作（支持可选的 targetThreadId，默认使用 currentThreadId）
    addUserMessage: (content: MessageContent, contextItems?: ContextItem[], targetThreadId?: string) => string
    prepareExecution: (content: MessageContent, contextItems: ContextItem[], targetThreadId?: string) => { userMessageId: string, assistantId: string, threadId: string }
    addAssistantMessage: (content?: string, targetThreadId?: string) => string
    addAssistantPartsMessage: (
        parts: AssistantPart[],
        options?: { content?: string; timestamp?: number },
        targetThreadId?: string
    ) => string
    appendToAssistant: (messageId: string, content: string, targetThreadId?: string) => void
    finalizeAssistant: (messageId: string, targetThreadId?: string) => void
    finalizeTextBeforeToolCall: (messageId: string, targetThreadId?: string) => void
    updateMessage: (messageId: string, updates: Partial<ChatMessage>, targetThreadId?: string) => void
    addToolResult: (toolCallId: string, name: string, content: string, type: ToolResultType, rawParams?: Record<string, unknown>, targetThreadId?: string) => string
    addCheckpoint: (type: 'user_message' | 'tool_edit', fileSnapshots: Record<string, FileSnapshot>, targetThreadId?: string) => string
    clearMessages: (targetThreadId?: string) => void
    deleteMessagesAfter: (messageId: string, targetThreadId?: string) => void
    getMessages: (targetThreadId?: string) => ChatMessage[]

    // 工具调用操作
    addToolCallPart: (messageId: string, toolCall: Omit<ToolCall, 'status'>, targetThreadId?: string) => void
    updateToolCall: (messageId: string, toolCallId: string, updates: Partial<ToolCall>, targetThreadId?: string) => void
    startToolExecution: (
        messageId: string,
        toolCall: Omit<ToolCall, 'status'>,
        streamContext: ToolExecutionStreamContext,
        targetThreadId?: string
    ) => void
    finishToolExecution: (
        messageId: string,
        toolCallId: string,
        updates: Partial<ToolCall>,
        result: ToolExecutionResultRecord,
        targetThreadId?: string
    ) => string

    // Reasoning 操作
    addReasoningPart: (messageId: string, targetThreadId?: string) => string
    updateReasoningPart: (messageId: string, partId: string, content: string, isStreaming?: boolean, targetThreadId?: string) => void
    finalizeReasoningPart: (messageId: string, partId: string, targetThreadId?: string) => void

    // Search 操作
    addSearchPart: (messageId: string, targetThreadId?: string) => string
    updateSearchPart: (messageId: string, partId: string, content: string, isStreaming?: boolean, append?: boolean, targetThreadId?: string) => void
    finalizeSearchPart: (messageId: string, partId: string, targetThreadId?: string) => void

    // Sources 操作
    upsertSourcesPart: (messageId: string, source: LLMStreamSource, targetThreadId?: string) => void

    // Lint Check 操作
    addLintCheckPart: (messageId: string, targetThreadId?: string) => void
    updateLintCheckPart: (messageId: string, updates: Partial<import('../../types').LintCheckPart>, targetThreadId?: string) => void
    addSystemAlertPart: (
        messageId: string,
        alert: {
            alertType: 'error' | 'warning' | 'info' | 'success'
            title?: string
            message: string
            suggestion?: string
            compact?: boolean
        },
        targetThreadId?: string
    ) => void

    // 交互式内容操作
    setInteractive: (messageId: string, interactive: InteractiveContent, targetThreadId?: string) => void

    // 上下文操作
    addSkillsToMessage: (messageId: string, skills: { name: string; description: string }[], targetThreadId?: string) => void
    addContextItem: (item: ContextItem, targetThreadId?: string) => void
    removeContextItem: (index: number, targetThreadId?: string) => void
    clearContextItems: (targetThreadId?: string) => void

    // 内部方法
    _doAppendToAssistant: (messageId: string, content: string, targetThreadId?: string) => void
    _doUpdateReasoningPart: (messageId: string, partId: string, content: string, isStreaming: boolean, targetThreadId?: string) => void
}

export type MessageSlice = MessageActions

// ===== 辅助函数 =====

const generateId = () => crypto.randomUUID()

function getInterruptedToolMessage(): string {
    const language = useStore.getState().language as 'en' | 'zh'
    return t('agent.tool.interruptedOrParseFailed', language)
}

function getAssistantMessage(thread: ChatThread, messageId: string): AssistantMessage | undefined {
    if (thread.liveAssistantMessage?.id === messageId) {
        return thread.liveAssistantMessage
    }

    return thread.messages.find(
        message => message.id === messageId && message.role === 'assistant'
    ) as AssistantMessage | undefined
}

function replaceAssistantMessage(
    thread: ChatThread,
    assistantMessage: AssistantMessage
): ChatMessage[] | null {
    const messageIndex = thread.messages.findIndex(message => message.id === assistantMessage.id)
    if (messageIndex === -1) return null

    const nextMessages = thread.messages.slice()
    nextMessages[messageIndex] = assistantMessage
    return nextMessages
}

/**
 * 发布一条助手消息的新版本，自动选择「覆盖层」还是「落进 messages」。
 *
 * 流式期间走覆盖层（`liveAssistantMessage`）：token 只改动活跃那一行，不改时间线
 * 成员关系，因此不发布新的 messages 版本，ChatPanel 不必重扫长历史。
 *
 * 但覆盖层只在消息仍然 `isStreaming` 时会被渲染 —— ChatMessage 的 live selector
 * 要求 `messageIsStreaming` 为真才读 live parts。所以对已经收尾的消息写覆盖层，
 * 结果是「看不见、却存下来了」：materializeThreadMessages 会把覆盖层内容写进
 * SQLite 和发给模型的历史，于是界面上的正文、库里的正文、模型看到的正文三者不一致，
 * 而且重启后那段内容会突然冒出来。
 *
 * 这条路径不是理论上的：用户按停止时 Agent.stop() 会立刻 finalizeAssistant，
 * 而 IPC 上的流事件监听还没摘掉，随后到达的 token / 检索结果收尾
 * （retrievalService.finalizeUI）打的就是一条已收尾的消息。
 *
 * 所以收尾之后的更新直接落进 messages 并发布新版本：可见、可持久化、与模型一致。
 * 消息已被截断（回滚检查点 / 切分支）时丢弃这次更新 —— 不能把它复活。
 */
function publishAssistantMessage(
    state: { threads: Record<string, ChatThread>; threadMessageVersions: Record<string, number> },
    threadId: string,
    thread: ChatThread,
    nextMessage: AssistantMessage
): Partial<{ threads: Record<string, ChatThread>; threadMessageVersions: Record<string, number> }> | null {
    if (nextMessage.isStreaming) {
        return {
            threads: {
                ...state.threads,
                [threadId]: { ...thread, liveAssistantMessage: nextMessage },
            },
        }
    }

    const messages = replaceAssistantMessage(thread, nextMessage)
    if (!messages) return null

    return {
        threadMessageVersions: bumpThreadMessageVersion(state.threadMessageVersions, threadId),
        threads: {
            ...state.threads,
            [threadId]: {
                ...thread,
                messages,
                ...(thread.liveAssistantMessage?.id === nextMessage.id
                    ? { liveAssistantMessage: undefined }
                    : {}),
            },
        },
    }
}

/**
 * Trim a thread's stored history to `maxStoredMessagesPerThread`.
 *
 * Thread count and per-thread message count are bounded independently. SQLite
 * avoids full-history rewrites, but unbounded histories still increase memory,
 * startup hydration, backup size, and model-context work.
 *
 * The cut point is chosen carefully: dropping a `tool` message while keeping the
 * `assistant` message whose `tool_calls` reference it produces an orphaned tool
 * result, which many providers reject outright. So the boundary is advanced to the
 * next `user` message, which is always a safe splice point.
 */
function trimStoredMessages(messages: ChatMessage[], limit: number): ChatMessage[] {
    if (limit <= 0 || messages.length <= limit) return messages

    let cut = messages.length - limit
    while (cut < messages.length && messages[cut].role !== 'user') {
        cut++
    }
    // No later user message: keep the tail intact rather than orphaning tool results.
    if (cut >= messages.length) return messages

    return messages.slice(cut)
}

function isHandoffSnapshotOnlyAssistantMessage(message: AssistantMessage): boolean {
    return (
        message.parts.length > 0 &&
        message.parts.every(part => part.type === 'context_snapshot' && part.snapshotKind === 'handoff')
    )
}

function getSourceStableKey(source: LLMStreamSource): string {
    return source.id || source.url || source.filename || `${source.sourceType}:${source.title || 'unknown'}`
}

function mergeSourceEntry(current: LLMStreamSource, incoming: LLMStreamSource): LLMStreamSource {
    const merged: LLMStreamSource = {
        ...current,
        ...incoming,
        id: incoming.id || current.id,
        sourceType: incoming.sourceType || current.sourceType,
    }

    return (
        merged.id === current.id &&
        merged.sourceType === current.sourceType &&
        merged.url === current.url &&
        merged.title === current.title &&
        merged.mediaType === current.mediaType &&
        merged.filename === current.filename
    )
        ? current
        : merged
}

// ===== Slice 创建器 =====

export const createMessageSlice: StateCreator<
    ThreadSlice & MessageSlice & BranchSlice & StreamFlushSlice,
    [],
    [],
    MessageSlice
> = (set, get) => ({
    // 添加用户消息
    addUserMessage: (content, contextItems, targetThreadId) => {
        let threadId = targetThreadId || get().currentThreadId

        if (!threadId || !get().threads[threadId]) {
            threadId = get().createThread({ activate: !targetThreadId })
        }

        const message: UserMessage = {
            id: generateId(),
            role: 'user',
            content,
            timestamp: Date.now(),
            contextItems,
        }

        set(state => {
            const thread = state.threads[threadId!]
            if (!thread) return state

            return {
                threadMessageVersions: bumpThreadMessageVersion(state.threadMessageVersions, threadId!),
                threads: {
                    ...state.threads,
                    [threadId!]: {
                        ...thread,
                        messages: [...materializeThreadMessages(thread), message],
                        liveAssistantMessage: undefined,
                        lastModified: Date.now(),
                    },
                },
            }
        })

        return message.id
    },

    // 批量初始化执行环境（性能优化：合并渲染与持久化）
    prepareExecution: (content, contextItems, targetThreadId) => {
        let threadId = targetThreadId || get().currentThreadId

        if (!threadId || !get().threads[threadId]) {
            threadId = get().createThread({ activate: !targetThreadId })
        }

        const userMessage: UserMessage = {
            id: generateId(),
            role: 'user',
            content,
            timestamp: Date.now(),
            contextItems: [...(contextItems || [])],
        }

        const assistantMessage: AssistantMessage = {
            id: generateId(),
            role: 'assistant',
            content: '',
            timestamp: Date.now() + 1, // 确保在用户消息之后
            isStreaming: true,
            parts: [],
            toolCalls: [],
            contextItems: [...(contextItems || [])],
        }

        set(state => {
            const thread = state.threads[threadId!]
            if (!thread) return state

            // Bound stored history once per turn. Uses a much larger limit than the
            // model payload cap, so scrollback stays useful.
            const appended = [...materializeThreadMessages(thread), userMessage, assistantMessage]
            const messages = trimStoredMessages(
                appended,
                getAgentConfig().maxStoredMessagesPerThread
            )

            return {
                threadMessageVersions: bumpThreadMessageVersion(state.threadMessageVersions, threadId!),
                threads: {
                    ...state.threads,
                    [threadId!]: {
                        ...thread,
                        messages,
                        liveAssistantMessage: assistantMessage,
                        lastModified: Date.now(),
                        streamState: { ...thread.streamState, phase: 'streaming' },
                        contextItems: [], // 同时清理上下文
                    },
                },
            }
        })

        return { userMessageId: userMessage.id, assistantId: assistantMessage.id, threadId: threadId! }
    },

    // 添加助手消息
    addAssistantMessage: (content = '', targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return ''

        const message: AssistantMessage = {
            id: generateId(),
            role: 'assistant',
            content,
            timestamp: Date.now(),
            isStreaming: true,
            parts: content ? [{ type: 'text', content }] : [],
            toolCalls: [],
        }

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            return {
                threadMessageVersions: bumpThreadMessageVersion(state.threadMessageVersions, threadId),
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        messages: [...materializeThreadMessages(thread), message],
                        liveAssistantMessage: message,
                        lastModified: Date.now(),
                        streamState: { ...thread.streamState, phase: 'streaming' },
                    },
                },
            }
        })

        return message.id
    },

    addAssistantPartsMessage: (parts, options, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return ''

        const message: AssistantMessage = {
            id: generateId(),
            role: 'assistant',
            content: options?.content ?? '',
            timestamp: options?.timestamp ?? Date.now(),
            isStreaming: false,
            parts: [...parts],
            toolCalls: [],
        }

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            return {
                threadMessageVersions: bumpThreadMessageVersion(state.threadMessageVersions, threadId),
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        messages: [...materializeThreadMessages(thread), message],
                        liveAssistantMessage: undefined,
                        lastModified: Date.now(),
                    },
                },
            }
        })

        return message.id
    },

    /**
     * 追加内容到助手消息
     * 
     * 通过 StreamingBuffer 进行节流优化，减少 React 渲染次数。
     * StreamingBuffer 会批量收集内容，然后调用 _doAppendToAssistant 执行实际更新。
     */
    appendToAssistant: (messageId, content, targetThreadId) => {
        streamingBuffer.append(messageId, content, targetThreadId)
    },

    // 内部方法：实际执行内容追加（由 StreamingBuffer 调用）
    _doAppendToAssistant: (messageId: string, content: string, targetThreadId?: string) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const assistantMsg = getAssistantMessage(thread, messageId)
            if (!assistantMsg) return state
            const newContent = assistantMsg.content + content

            let newParts: AssistantPart[]
            const lastPart = assistantMsg.parts[assistantMsg.parts.length - 1]

            // 检查是否有 _textFinalized 标记（表示文本已结束，工具调用即将开始）
            const textFinalized = assistantMsg._textFinalized

            // 如果文本已 finalized，或最后一个 part 不是 text，创建新的 text part
            if (textFinalized || !lastPart || lastPart.type !== 'text') {
                newParts = [...assistantMsg.parts, { type: 'text', content }]
            } else {
                // 追加到现有的 text part
                newParts = [...assistantMsg.parts]
                newParts[newParts.length - 1] = { type: 'text', content: lastPart.content + content }
            }

            // 构建新消息对象，清除 _textFinalized 标记（通过解构避免直接修改 state）
            const { _textFinalized: _, ...cleanMsg } = assistantMsg
            const nextMessage: AssistantMessage = {
                ...cleanMsg,
                content: newContent,
                parts: newParts,
            }

            // A token chunk changes only the active row, not timeline membership.
            // Keep the settled message-list revision stable so ChatPanel does not
            // rescan long history; finalizeAssistant publishes the final revision.
            return publishAssistantMessage(state, threadId, thread, nextMessage) ?? state
        })
    },

    // 完成助手消息
    finalizeAssistant: (messageId, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const assistantMsg = getAssistantMessage(thread, messageId)
            if (!assistantMsg) return state

            // 清理幽灵工具调用：如果 LLM 已结束，但仍有处于非终态的工具，将它们标记为错误
            const cleanToolCall = (toolCall: ToolCall): ToolCall => {
                if (['pending', 'running', 'awaiting'].includes(toolCall.status)) {
                    return { ...toolCall, status: 'error', result: getInterruptedToolMessage() }
                }
                return toolCall
            }
            const finalizedMessage: AssistantMessage = {
                ...assistantMsg,
                isStreaming: false,
                toolCalls: assistantMsg.toolCalls?.map(cleanToolCall),
                parts: assistantMsg.parts.map(part => part.type === 'tool_call'
                    ? { ...part, toolCall: cleanToolCall(part.toolCall) }
                    : part),
            }
            // 消息可能已经不在 messages 里了（回滚检查点 / 切分支会截断历史，
            // 而这些操作没有被 isStreaming 拦住）。这时仍然必须收尾：
            // 早期实现在这里直接 return state，于是 liveAssistantMessage 和
            // phase: 'streaming' 被永久留下 —— selectIsStreaming 恒为 true，
            // 持久化订阅整个会话不再落盘，新消息全被塞进发送队列且永不消费，
            // 只有按停止键才能恢复。丢一条已经不存在的消息可以，卡死不行。
            const messages = replaceAssistantMessage(thread, finalizedMessage)

            return {
                threadMessageVersions: bumpThreadMessageVersion(state.threadMessageVersions, threadId),
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        ...(messages ? { messages } : {}),
                        liveAssistantMessage: undefined,
                        streamState: { ...thread.streamState, phase: 'idle' },
                    },
                },
            }
        })

        const latestState = get() as any as {
            threads: Record<string, { handoffResume?: unknown; messages: ChatMessage[] }>
            contextTransition?: { status?: string; targetThreadId?: string }
            clearContextTransition?: () => void
        }
        const latestThread = latestState.threads[threadId]
        const finalizedMessage = latestThread?.messages.find(
            msg => msg.id === messageId && msg.role === 'assistant'
        ) as AssistantMessage | undefined

        if (
            latestThread?.handoffResume &&
            finalizedMessage &&
            !isHandoffSnapshotOnlyAssistantMessage(finalizedMessage) &&
            latestState.contextTransition?.status === 'switching' &&
            latestState.contextTransition.targetThreadId === threadId
        ) {
            latestState.clearContextTransition?.()
        }

        get().clearToolStreamingPreviews(threadId)
    },

    /**
     * 在工具调用前结束文本输出
     * 确保工具调用出现在文本之后的正确位置
     */
    finalizeTextBeforeToolCall: (messageId, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        // 关键修复：先刷新文本缓冲区，确保所有文本都已写入
        get()._flushTextBuffer(messageId)

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const assistantMsg = getAssistantMessage(thread, messageId)
            if (!assistantMsg) return state
            const lastPart = assistantMsg.parts[assistantMsg.parts.length - 1]
            const hasLiveMessage = thread.liveAssistantMessage?.id === messageId
            if (lastPart?.type !== 'text' && !hasLiveMessage) return state
            const finalizedMessage: AssistantMessage = lastPart?.type === 'text'
                ? { ...assistantMsg, _textFinalized: true }
                : assistantMsg
            const messages = replaceAssistantMessage(thread, finalizedMessage)
            if (!messages) return state

            return {
                threadMessageVersions: bumpThreadMessageVersion(state.threadMessageVersions, threadId),
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        messages,
                        liveAssistantMessage: undefined,
                    },
                },
            }
        })
    },

    // 更新消息
    updateMessage: (messageId, updates, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const messages = materializeThreadMessages(thread).map(msg => {
                if (msg.id === messageId) {
                    if (msg.role === 'assistant') {
                        const assistantMsg = msg as AssistantMessage
                        const assistantUpdates = updates as Partial<AssistantMessage>

                        return {
                            ...assistantMsg,
                            ...assistantUpdates,
                            parts: assistantUpdates.parts ?? assistantMsg.parts,
                            toolCalls: assistantUpdates.toolCalls ?? assistantMsg.toolCalls,
                        } as ChatMessage
                    }

                    return { ...msg, ...updates } as ChatMessage
                }
                return msg
            })

            return {
                threadMessageVersions: bumpThreadMessageVersion(state.threadMessageVersions, threadId),
                threads: {
                    ...state.threads,
                        [threadId]: {
                            ...thread,
                            messages,
                            liveAssistantMessage: undefined,
                            lastModified: Date.now(),
                        },
                },
            }
        })
    },

    // 添加工具结果
    addToolResult: (toolCallId, name, content, type, rawParams, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return ''

        const message: ToolResultMessage = {
            id: generateId(),
            role: 'tool',
            toolCallId,
            name,
            content,
            timestamp: Date.now(),
            type,
            rawParams,
        }

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            return {
                threadMessageVersions: bumpThreadMessageVersion(state.threadMessageVersions, threadId),
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        messages: [...thread.messages, message],
                        lastModified: Date.now(),
                    },
                },
            }
        })

        return message.id
    },

    // 添加检查点
    addCheckpoint: (type, fileSnapshots, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return ''

        const message: CheckpointMessage = {
            id: generateId(),
            role: 'checkpoint',
            type,
            timestamp: Date.now(),
            fileSnapshots,
        }

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            let newMessages = [...thread.messages, message]

            // 限制 checkpoint 消息数量，防止内存膨胀
            const MAX_CHECKPOINTS = 20
            const checkpointMessages = newMessages.filter(m => m.role === 'checkpoint')
            if (checkpointMessages.length > MAX_CHECKPOINTS) {
                const oldestCheckpointId = checkpointMessages[0].id
                newMessages = newMessages.filter(m => m.id !== oldestCheckpointId)
            }

            return {
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        messages: newMessages,
                    },
                },
            }
        })

        return message.id
    },

    // 清空消息（同时清理检查点和待确认更改）
    clearMessages: (targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        // 压缩状态会在 store 中重置

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            // Branches hold full copies of the conversation, including the
            // synthetic `__mainline__` snapshot. Leaving them behind meant a user
            // who cleared their history still had that content on disk (it is
            // persisted to _extra.json) and could resurrect it by switching
            // branches. Clearing history must clear the copies too.
            const { [threadId]: _clearedBranches, ...remainingBranches } = state.branches || {}
            const { [threadId]: _clearedActiveBranch, ...remainingActiveBranch } = state.activeBranchId || {}

            return {
                threadMessageVersions: bumpThreadMessageVersion(state.threadMessageVersions, threadId),
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        messages: [],
                        liveAssistantMessage: undefined,
                        contextItems: [],
                        messageCheckpoints: [],
                        compressionStats: null,
                        contextSummary: null,
                        compressionPhase: 'idle',
                        handoff: createIdleHandoffState(),
                        lastModified: Date.now(),
                        state: { currentCheckpointIdx: null, isStreaming: false },
                    },
                },
                branches: remainingBranches,
                activeBranchId: remainingActiveBranch,
                // 同时清理检查点和待确认更改
                pendingChanges: [],
            }
        })

        get().clearToolStreamingPreviews(threadId)

        // Persist immediately rather than relying on the debounce so a restart
        // cannot race the durable clear transaction.
        void persistCriticalAgentSessionState(
            buildPersistedAgentSessionState(get())
        )
    },

    // 删除指定消息之后的所有消息
    deleteMessagesAfter: (messageId, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        // 重置 handoff 状态（回退消息后可能不再需要 handoff）

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const materializedMessages = materializeThreadMessages(thread)
            const index = materializedMessages.findIndex(m => m.id === messageId)
            if (index === -1) return state

            const remainingMessages = materializedMessages.slice(0, index + 1)
            const remainingMessageIds = new Set(remainingMessages.map(message => message.id))

            return {
                threadMessageVersions: bumpThreadMessageVersion(state.threadMessageVersions, threadId),
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        messages: remainingMessages,
                        liveAssistantMessage: undefined,
                        messageCheckpoints: (thread.messageCheckpoints || []).filter(checkpoint => remainingMessageIds.has(checkpoint.messageId)),
                        compressionStats: null,
                        contextSummary: null,
                        compressionPhase: 'idle',
                        handoff: createIdleHandoffState(),
                        lastModified: Date.now(),
                    },
                },
            }
        })

        get().clearToolStreamingPreviews(threadId)
    },

    // 获取消息列表
    getMessages: (targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return []

        const thread = get().threads[threadId]
        return thread ? materializeThreadMessages(thread) : []
    },

    // 添加工具调用部分
    addToolCallPart: (messageId, toolCall, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        const persistedToolCall: Omit<ToolCall, 'status'> = {
            ...toolCall,
            streamingState: undefined,
        }

        // 刷缓冲由 mutateAssistantRow 负责，它保证「先落地正文，再改 parts」——
        // 否则工具卡片会插到它本应跟随的那段文字前面
        mutateAssistantRow(set, get, {
            threadId,
            messageId,
            edit: assistantMsg => {
                // 重复宣告同一个工具调用：什么都不做（以前这里仍然 bump 版本 + 清覆盖层）
                if (assistantMsg.toolCalls?.some(tc => tc.id === toolCall.id)) return assistantMsg

                const newToolCall: ToolCall = { ...persistedToolCall, status: 'pending' }

                return {
                    ...assistantMsg,
                    parts: [...assistantMsg.parts, { type: 'tool_call', toolCall: newToolCall }],
                    toolCalls: [...(assistantMsg.toolCalls || []), newToolCall],
                }
            },
        })
    },

    // 更新工具调用（如果不存在则添加）
    updateToolCall: (messageId, toolCallId, updates, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        const hasStreamingStateUpdate = Object.prototype.hasOwnProperty.call(updates, 'streamingState')
        const previewState = updates.streamingState
        const currentPreview = get().getToolStreamingPreview(toolCallId, threadId)
        const hasStablePayloadUpdate = ['arguments', 'result', 'error', 'richContent'].some(key =>
            Object.prototype.hasOwnProperty.call(updates, key)
        )
        const shouldStageNameInPreview =
            typeof updates.name === 'string' &&
            !!previewState?.isStreaming &&
            !hasStablePayloadUpdate

        if (hasStreamingStateUpdate && previewState) {
            get().setToolStreamingPreview(toolCallId, {
                ...currentPreview,
                ...previewState,
                name: shouldStageNameInPreview ? updates.name : (previewState.name ?? currentPreview?.name),
            }, threadId)
        } else if (shouldStageNameInPreview) {
            get().setToolStreamingPreview(toolCallId, {
                ...(currentPreview || { isStreaming: true }),
                name: updates.name,
            }, threadId)
        }

        const shouldClearPreview =
            (hasStreamingStateUpdate && previewState === undefined) ||
            (updates.status !== undefined && !['pending', 'running', 'awaiting'].includes(updates.status))

        const cleanUpdates = Object.fromEntries(
            Object.entries(updates).filter(([key, value]) => key !== 'streamingState' && value !== undefined)
        ) as Partial<ToolCall>

        if (shouldStageNameInPreview) {
            delete cleanUpdates.name
        }

        if (Object.keys(cleanUpdates).length === 0) {
            if (shouldClearPreview) {
                get().clearToolStreamingPreview(toolCallId, threadId)
            }
            return
        }

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            let updated = false
            // 必须读 materializeThreadMessages 而不是 thread.messages：覆盖层存在时
            // thread.messages 里那条是旧快照，在它上面改工具状态再写回去，
            // 随后任何一次 materialize（持久化 / 发给模型 / 下一次落地写入）都会
            // 用覆盖层把整条消息盖回去，这次工具更新就凭空消失了。
            const messages = materializeThreadMessages(thread).map(msg => {
                if (msg.id === messageId && msg.role === 'assistant') {
                    const assistantMsg = msg as AssistantMessage

                    // 检查工具调用是否已存在
                    const existingToolCall = assistantMsg.toolCalls?.find(tc => tc.id === toolCallId)

                    if (existingToolCall) {
                        // 更新已存在的工具调用
                        updated = true

                        // 创建新的 toolCall 对象（确保引用变化）
                        const updatedToolCall = { ...existingToolCall, ...cleanUpdates }

                        const newParts = assistantMsg.parts.map(part => {
                            if (part.type === 'tool_call' && part.toolCall.id === toolCallId) {
                                return { ...part, toolCall: updatedToolCall }
                            }
                            return part
                        })

                        const newToolCalls = assistantMsg.toolCalls?.map(tc =>
                            tc.id === toolCallId ? updatedToolCall : tc
                        )

                        return { ...assistantMsg, parts: newParts, toolCalls: newToolCalls }
                    }

                    return msg
                }
                return msg
            })

            // 如果没有更新，返回原状态避免不必要的重渲染
            if (!updated) return state

            return {
                threadMessageVersions: bumpThreadMessageVersion(state.threadMessageVersions, threadId),
                threads: {
                    ...state.threads,
                    [threadId]: { ...thread, messages, liveAssistantMessage: undefined, lastModified: Date.now() },
                },
            }
        })

        if (shouldClearPreview) {
            get().clearToolStreamingPreview(toolCallId, threadId)
        }
    },

    /**
     * Atomically publishes a tool's canonical running state. Tool execution is
     * a single UI transition, so splitting it across message, preview and
     * stream-state writes only multiplies subscriber work under concurrency.
     */
    startToolExecution: (messageId, toolCall, streamContext, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        const runningToolCall: ToolCall = {
            ...toolCall,
            status: 'running',
            streamingState: undefined,
        }

        mutateAssistantRow(set, get, {
            threadId,
            messageId,
            edit: assistantMessage => {
                const existingToolCall = assistantMessage.toolCalls?.find(call => call.id === toolCall.id)

                return {
                    ...assistantMessage,
                    _textFinalized: true,
                    parts: existingToolCall
                        ? assistantMessage.parts.map(part =>
                            part.type === 'tool_call' && part.toolCall.id === toolCall.id
                                ? { ...part, toolCall: runningToolCall }
                                : part
                        )
                        : [...assistantMessage.parts, { type: 'tool_call' as const, toolCall: runningToolCall }],
                    toolCalls: existingToolCall
                        ? assistantMessage.toolCalls?.map(call => call.id === toolCall.id ? runningToolCall : call)
                        : [...(assistantMessage.toolCalls || []), runningToolCall],
                }
            },
            // phase 在这里被写成 'tool_running'，但恢复成 'streaming' 发生在整个子系统的
            // 另一头（core/tools.ts 的工具循环收尾）。这是最难自己看出来的一条耦合。
            streamState: {
                phase: 'tool_running',
                currentToolCall: runningToolCall,
                statusText: undefined,
                ...streamContext,
            },
            dropPreviews: [toolCall.id],
            touchLastModified: true,
        })
    },

    /** Atomically commits the final tool-call state and its model-facing result. */
    finishToolExecution: (messageId, toolCallId, updates, result, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return ''

        const resultMessage: ToolResultMessage = {
            id: generateId(),
            role: 'tool',
            toolCallId,
            name: result.name,
            content: result.content,
            timestamp: Date.now(),
            type: result.type,
            rawParams: result.rawParams,
        }
        const cleanUpdates = Object.fromEntries(
            Object.entries(updates).filter(([key, value]) => key !== 'streamingState' && value !== undefined)
        ) as Partial<ToolCall>

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            // 同 updateToolCall：覆盖层存在时 thread.messages 里的那条是旧快照，
            // 直接改它会在下一次 materialize 时被覆盖层整条盖掉，工具的终态和结果
            // 就都丢了。这里顺手把覆盖层落地（settle），流式的下一个 token 会重建它。
            const messages = materializeThreadMessages(thread).slice()
            const messageIdx = messages.findIndex(
                message => message.id === messageId && message.role === 'assistant'
            )

            if (messageIdx !== -1) {
                const assistantMessage = messages[messageIdx] as AssistantMessage
                const existingToolCall = assistantMessage.toolCalls?.find(call => call.id === toolCallId)
                if (existingToolCall) {
                    const completedToolCall = { ...existingToolCall, ...cleanUpdates }
                    messages[messageIdx] = {
                        ...assistantMessage,
                        parts: assistantMessage.parts.map(part =>
                            part.type === 'tool_call' && part.toolCall.id === toolCallId
                                ? { ...part, toolCall: completedToolCall }
                                : part
                        ),
                        toolCalls: assistantMessage.toolCalls?.map(call =>
                            call.id === toolCallId ? completedToolCall : call
                        ),
                    }
                }
            }
            messages.push(resultMessage)

            const toolStreamingPreviews = thread.toolStreamingPreviews?.[toolCallId]
                ? Object.fromEntries(
                    Object.entries(thread.toolStreamingPreviews).filter(([id]) => id !== toolCallId)
                )
                : thread.toolStreamingPreviews

            return {
                threadMessageVersions: bumpThreadMessageVersion(state.threadMessageVersions, threadId),
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        messages,
                        liveAssistantMessage: undefined,
                        toolStreamingPreviews,
                        lastModified: Date.now(),
                    },
                },
            }
        })

        return resultMessage.id
    },

    // 添加推理部分
    addReasoningPart: (messageId, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return ''

        const partId = `reasoning-${crypto.randomUUID()}`

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const assistantMsg = getAssistantMessage(thread, messageId)
            if (!assistantMsg) return state
            const newPart: ReasoningPart = {
                id: partId,
                type: 'reasoning',
                content: '',
                startTime: Date.now(),
                isStreaming: true,
            }
            const nextMessage: AssistantMessage = {
                ...assistantMsg,
                parts: [...assistantMsg.parts, newPart],
            }

            return publishAssistantMessage(state, threadId, thread, nextMessage) ?? state
        })

        return partId
    },

    /**
     * 更新推理部分
     *
     * 与 appendToAssistant 一样经 StreamingBuffer 节流：推理 token 与文本
     * 同速率到达，若直接 set 会绕过节流，每个 token 触发一次全量 store 更新。
     */
    updateReasoningPart: (messageId, partId, content, isStreaming = true, targetThreadId) => {
        streamingBuffer.appendReasoning(messageId, partId, content, isStreaming, targetThreadId)
    },

    // 内部方法：实际执行推理内容追加（由 StreamingBuffer 调用）
    _doUpdateReasoningPart: (messageId: string, partId: string, content: string, isStreaming: boolean, targetThreadId?: string) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const assistantMsg = getAssistantMessage(thread, messageId)
            if (!assistantMsg) return state
            const nextMessage: AssistantMessage = {
                ...assistantMsg,
                parts: assistantMsg.parts.map(part => {
                    if (part.type === 'reasoning' && part.id === partId) {
                        return { ...part, content: part.content + content, isStreaming }
                    }
                    return part
                }),
            }

            return publishAssistantMessage(state, threadId, thread, nextMessage) ?? state
        })
    },

    // 完成推理部分
    finalizeReasoningPart: (messageId, partId, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const assistantMsg = getAssistantMessage(thread, messageId)
            if (!assistantMsg) return state
            const nextMessage: AssistantMessage = {
                ...assistantMsg,
                parts: assistantMsg.parts.map(part => {
                    if (part.type === 'reasoning' && part.id === partId) {
                        return { ...part, isStreaming: false }
                    }
                    return part
                }),
            }

            return publishAssistantMessage(state, threadId, thread, nextMessage) ?? state
        })
    },

    // 添加搜索部分
    addSearchPart: (messageId, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return ''

        const partId = `search-${Date.now()}`

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const assistantMsg = getAssistantMessage(thread, messageId)
            if (!assistantMsg) return state
            const newPart: SearchPart = {
                id: partId,
                type: 'search',
                content: '',
                isStreaming: true,
            }
            const nextMessage: AssistantMessage = {
                ...assistantMsg,
                parts: [...assistantMsg.parts, newPart],
            }

            return publishAssistantMessage(state, threadId, thread, nextMessage) ?? state
        })

        return partId
    },

    // 更新搜索部分
    updateSearchPart: (messageId, partId, content, isStreaming = true, append = false, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const assistantMsg = getAssistantMessage(thread, messageId)
            if (!assistantMsg) return state
            const nextMessage: AssistantMessage = {
                ...assistantMsg,
                parts: assistantMsg.parts.map(part => {
                    if (part.type === 'search' && part.id === partId) {
                        const newContent = append ? part.content + content : content
                        return { ...part, content: newContent, isStreaming }
                    }
                    return part
                }),
            }

            return publishAssistantMessage(state, threadId, thread, nextMessage) ?? state
        })
    },

    // 完成搜索部分
    finalizeSearchPart: (messageId, partId, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const assistantMsg = getAssistantMessage(thread, messageId)
            if (!assistantMsg) return state
            const nextMessage: AssistantMessage = {
                ...assistantMsg,
                parts: assistantMsg.parts.map(part => {
                    if (part.type === 'search' && part.id === partId) {
                        return { ...part, isStreaming: false }
                    }
                    return part
                }),
            }

            return publishAssistantMessage(state, threadId, thread, nextMessage) ?? state
        })
    },

    upsertSourcesPart: (messageId, source, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const sourceKey = getSourceStableKey(source)
            const assistantMsg = getAssistantMessage(thread, messageId)
            if (!assistantMsg) return state
            const partIndex = assistantMsg.parts.findIndex(part => part.type === 'sources')
            const existingPart = partIndex >= 0 ? assistantMsg.parts[partIndex] as SourcesPart : undefined
            const nextSources = existingPart
                ? (() => {
                    const existingIndex = existingPart.sources.findIndex(item => getSourceStableKey(item) === sourceKey)
                    if (existingIndex === -1) return [...existingPart.sources, source]

                    const merged = mergeSourceEntry(existingPart.sources[existingIndex], source)
                    if (merged === existingPart.sources[existingIndex]) return existingPart.sources

                    const cloned = [...existingPart.sources]
                    cloned[existingIndex] = merged
                    return cloned
                })()
                : [source]
            if (existingPart && nextSources === existingPart.sources) return state

            const nextParts: AssistantMessage['parts'] = [...assistantMsg.parts]
            if (existingPart) {
                nextParts[partIndex] = { ...existingPart, sources: nextSources }
            } else {
                nextParts.push({ type: 'sources', sources: nextSources })
            }
            const updatedMessage: AssistantMessage = { ...assistantMsg, parts: nextParts }

            return publishAssistantMessage(state, threadId, thread, updatedMessage) ?? state
        })
    },

    // 添加 Lint Check 部分
    addLintCheckPart: (messageId, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const messages = materializeThreadMessages(thread).map(msg => {
                if (msg.id === messageId && msg.role === 'assistant') {
                    const assistantMsg = msg as AssistantMessage
                    const newPart: AssistantPart = { type: 'lint_check', files: [], status: 'checking' }
                    return { ...assistantMsg, parts: [...assistantMsg.parts, newPart] }
                }
                return msg
            })

            return {
                threadMessageVersions: bumpThreadMessageVersion(state.threadMessageVersions, threadId),
                threads: {
                    ...state.threads,
                    [threadId]: { ...thread, messages, liveAssistantMessage: undefined },
                },
            }
        })
    },

    // 更新 Lint Check 部分
    updateLintCheckPart: (messageId, updates, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const messages = materializeThreadMessages(thread).map(msg => {
                if (msg.id === messageId && msg.role === 'assistant') {
                    const assistantMsg = msg as AssistantMessage
                    const newParts = assistantMsg.parts.map(part => {
                        if (part.type === 'lint_check') {
                            return { ...part, ...updates }
                        }
                        return part
                    })
                    return { ...assistantMsg, parts: newParts }
                }
                return msg
            })

            return {
                threadMessageVersions: bumpThreadMessageVersion(state.threadMessageVersions, threadId),
                threads: {
                    ...state.threads,
                    [threadId]: { ...thread, messages, liveAssistantMessage: undefined },
                },
            }
        })
    },

    addSystemAlertPart: (messageId, alert, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const messages = materializeThreadMessages(thread).map(msg => {
                if (msg.id === messageId && msg.role === 'assistant') {
                    const assistantMsg = msg as AssistantMessage
                    const newPart: AssistantPart = {
                        type: 'system_alert',
                        alertType: alert.alertType,
                        title: alert.title,
                        message: alert.message,
                        suggestion: alert.suggestion,
                        compact: 'compact' in alert ? Boolean((alert as { compact?: boolean }).compact) : false,
                    }
                    return { ...assistantMsg, parts: [...assistantMsg.parts, newPart] }
                }
                return msg
            })

            return {
                threadMessageVersions: bumpThreadMessageVersion(state.threadMessageVersions, threadId),
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        messages,
                        liveAssistantMessage: undefined,
                        lastModified: Date.now(),
                    },
                },
            }
        })
    },

    // 设置交互式内容（用于 ask_user 工具）
    setInteractive: (messageId, interactive, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const messages = materializeThreadMessages(thread).map(msg => {
                if (msg.id === messageId && msg.role === 'assistant') {
                    return { ...msg, interactive, isStreaming: false }
                }
                return msg
            })

            return {
                threadMessageVersions: bumpThreadMessageVersion(state.threadMessageVersions, threadId),
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        messages,
                        liveAssistantMessage: undefined,
                        streamState: { ...thread.streamState, phase: 'idle' },
                        lastModified: Date.now(),
                    },
                },
            }
        })
    },

    // 追加 auto 选中的 Skills 到指定消息的 contextItems
    addSkillsToMessage: (messageId, skills, targetThreadId) => {
        if (skills.length === 0) return
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId!]
            if (!thread) return state

            const messages = materializeThreadMessages(thread).map(msg => {
                if (msg.id !== messageId || msg.role !== 'assistant') return msg
                const aMsg = msg as AssistantMessage
                const items: ContextItem[] = aMsg.contextItems || []
                const existing = new Set(
                    items
                        .filter((i): i is import('../../types').SkillContext => i.type === 'Skill')
                        .map(i => i.skillId)
                )
                const newItems = skills
                    .filter(s => !existing.has(s.name))
                    .map(s => ({ type: 'Skill' as const, skillId: s.name, name: s.name, description: s.description, auto: true }))
                if (newItems.length === 0) return msg
                return { ...aMsg, contextItems: [...items, ...newItems] }
            })

            return {
                threadMessageVersions: bumpThreadMessageVersion(state.threadMessageVersions, threadId!),
                threads: {
                    ...state.threads,
                    [threadId!]: { ...thread, messages, liveAssistantMessage: undefined },
                }
            }
        })
    },

    // 添加上下文项
    addContextItem: (item, targetThreadId) => {
        let threadId = targetThreadId || get().currentThreadId

        if (!threadId || !get().threads[threadId]) {
            threadId = get().createThread({ activate: !targetThreadId })
        }

        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const exists = thread.contextItems.some(existing => {
                if (existing.type !== item.type) return false
                if ('uri' in existing && 'uri' in item) {
                    return existing.uri === item.uri
                }
                if (existing.type === 'ShellServer' && item.type === 'ShellServer') {
                    return existing.serverLinkId === item.serverLinkId
                }
                return existing.type === item.type
            })

            if (exists) return state

            return {
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        contextItems: [...thread.contextItems, item],
                    },
                },
            }
        })
    },

    // 移除上下文项
    removeContextItem: (index, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            return {
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        contextItems: thread.contextItems.filter((_, i) => i !== index),
                    },
                },
            }
        })
    },

    // 清空上下文项
    clearContextItems: (targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            return {
                threads: {
                    ...state.threads,
                    [threadId]: { ...thread, contextItems: [] },
                },
            }
        })
    },
})
