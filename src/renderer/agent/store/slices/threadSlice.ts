/**
 * Thread slice.
 * Owns thread lifecycle plus thread-scoped ephemeral streaming preview state.
 */

import type { StateCreator } from 'zustand'
import type { ChatThread, StreamState, CompressionPhase, TodoItem, ContextStats } from '../../types'
import type { CompressionStats } from '../../core/types'
import type { StructuredSummary } from '../../domains/context/types'
import type { BranchSlice } from './branchSlice'
import type { ToolStreamingPreview } from '@/shared/types'
import { agentSessionRepository } from '@/renderer/services/agentSessionRepository'
import { createRuntimeThreadState } from '../../types'
import { logger } from '@utils/Logger'

export interface ThreadStoreState {
    threads: Record<string, ChatThread>
    currentThreadId: string | null
    threadMessageVersions: Record<string, number>
}

export interface ThreadActions {
    createThread: (options?: { activate?: boolean }) => string
    switchThread: (threadId: string) => void
    deleteThread: (threadId: string) => void
    getCurrentThread: () => ChatThread | null

    setStreamState: (state: Partial<StreamState>, threadId?: string) => void
    setStreamPhase: (phase: StreamState['phase'], threadId?: string) => void
    setToolStreamingPreview: (toolCallId: string, preview: ToolStreamingPreview, threadId?: string) => void
    clearToolStreamingPreview: (toolCallId: string, threadId?: string) => void
    clearToolStreamingPreviews: (threadId?: string) => void
    getToolStreamingPreview: (toolCallId: string, threadId?: string) => ToolStreamingPreview | undefined
    setCompressionStats: (stats: CompressionStats | null, threadId?: string) => void
    setContextStats: (stats: ContextStats | null, threadId?: string) => void
    setContextSummary: (summary: StructuredSummary | null, threadId?: string) => void
    setCompressionPhase: (phase: CompressionPhase, threadId?: string) => void
    setHandoffRequired: (required: boolean, threadId?: string) => void
    setIsCompacting: (compacting: boolean, threadId?: string) => void

    setTodos: (todos: TodoItem[], threadId?: string) => void
    getTodos: (threadId?: string) => TodoItem[]
    setExecutionMeta: (meta: import('../../types').ThreadExecutionMeta | null, threadId?: string) => void
    updateExecutionMeta: (meta: Partial<import('../../types').ThreadExecutionMeta>, threadId?: string) => void
    clearExecutionMeta: (threadId?: string) => void
}

export type ThreadSlice = ThreadStoreState & ThreadActions

const generateId = () => crypto.randomUUID()

export const createEmptyThread = (): ChatThread => ({
    id: generateId(),
    createdAt: Date.now(),
    lastModified: Date.now(),
    messages: [],
    messagesHydrated: true,
    contextItems: [],
    messageCheckpoints: [],
    contextSummary: null,
    ...createRuntimeThreadState(),
})

const updateThread = (
    threads: Record<string, ChatThread>,
    threadId: string,
    updates: Partial<ChatThread>
): Record<string, ChatThread> => {
    const thread = threads[threadId]
    if (!thread) return threads

    return {
        ...threads,
        [threadId]: { ...thread, ...updates, lastModified: Date.now() },
    }
}

const updateThreadEphemeral = (
    threads: Record<string, ChatThread>,
    threadId: string,
    updates: Partial<ChatThread>
): Record<string, ChatThread> => {
    const thread = threads[threadId]
    if (!thread) return threads

    return {
        ...threads,
        [threadId]: { ...thread, ...updates },
    }
}

const arePreviewArgsEqual = (
    left?: Record<string, unknown>,
    right?: Record<string, unknown>
): boolean => {
    if (left === right) return true
    if (!left || !right) return !left && !right

    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false

    for (const key of leftKeys) {
        if (left[key] !== right[key]) {
            return false
        }
    }

    return true
}

export const createThreadSlice: StateCreator<
    ThreadSlice & BranchSlice,
    [],
    [],
    ThreadSlice
> = (set, get) => ({
    threads: {},
    currentThreadId: null,
    threadMessageVersions: {},

    createThread: (options) => {
        const thread = createEmptyThread()
        const activate = options?.activate ?? true
        let shouldFlushImmediately = false
        logger.agent.warn('[ThreadSlice] createThread invoked', {
            activate,
            currentThreadId: get().currentThreadId,
            stack: new Error().stack,
        })

        set(state => {
            const newThreads = { ...state.threads, [thread.id]: thread }
            let newBranches = state.branches
            let newActiveBranch = state.activeBranchId

            const MAX_THREADS = 50
            const threadIds = Object.keys(newThreads)
            if (threadIds.length > MAX_THREADS) {
                const sorted = threadIds
                    .filter(id => id !== thread.id)
                    .map(id => ({ id, lastModified: newThreads[id].lastModified }))
                    .sort((a, b) => a.lastModified - b.lastModified)

                const toDelete = sorted.slice(0, threadIds.length - MAX_THREADS)
                newBranches = { ...newBranches }
                newActiveBranch = { ...newActiveBranch }

                for (const { id } of toDelete) {
                    delete newThreads[id]
                    delete newBranches[id]
                    delete newActiveBranch[id]
                }
            }

            shouldFlushImmediately = activate && state.currentThreadId !== thread.id

            return {
                threads: newThreads,
                currentThreadId: activate ? thread.id : state.currentThreadId,
                threadMessageVersions: {
                    ...state.threadMessageVersions,
                    [thread.id]: 0,
                },
                branches: newBranches,
                activeBranchId: newActiveBranch,
            }
        })

        if (shouldFlushImmediately) {
            void agentSessionRepository.flush()
        }

        return thread.id
    },

    switchThread: (threadId) => {
        const state = get()
        if (!state.threads[threadId]) return
        if (state.currentThreadId === threadId) return
        set({ currentThreadId: threadId })
        void agentSessionRepository.flush()

        // 懒加载切换后线程的消息
        const thread = state.threads[threadId]
        if (thread?.messagesHydrated === false) {
            agentSessionRepository.loadThreadMessages(threadId).then(messages => {
                // 无论消息是否为空，都触发一次 set，确保 ChatPanel 的 useEffect
                // 检测到 filteredMessages 引用变化，能正常退出骨架屏状态
                set(state => ({
                    threads: {
                        ...state.threads,
                        [threadId]: {
                            ...state.threads[threadId],
                            messages,
                            messagesHydrated: true,
                            messageCount: messages.length,
                        },
                    },
                }))
            }).catch(err => {
                console.error('[ThreadSlice] Failed to load messages:', err)
                // 加载失败时也强制触发 set，让骨架屏能正常退出
                set(state => ({
                    threads: {
                        ...state.threads,
                        [threadId]: {
                            ...state.threads[threadId],
                            messages: [],
                            messagesHydrated: true,
                        },
                    },
                }))
            })
        }
    },

    deleteThread: (threadId) => {
        let didDelete = false

        set(state => {
            if (!state.threads[threadId]) return state

            const { [threadId]: _thread, ...remaining } = state.threads
            const remainingIds = Object.keys(remaining)
            const { [threadId]: _messageVersion, ...remainingMessageVersions } = state.threadMessageVersions
            const { [threadId]: _branch, ...remainingBranches } = state.branches || {}
            const { [threadId]: _activeBranch, ...remainingActiveBranch } = state.activeBranchId || {}
            didDelete = true

            return {
                threads: remaining,
                currentThreadId: state.currentThreadId === threadId
                    ? (remainingIds[0] || null)
                    : state.currentThreadId,
                threadMessageVersions: remainingMessageVersions,
                branches: remainingBranches,
                activeBranchId: remainingActiveBranch,
            }
        })

        if (didDelete) {
            // 删除 JSONL 文件和元数据
            void agentSessionRepository.deleteThread(threadId)
        }
    },

    getCurrentThread: () => {
        const state = get()
        if (!state.currentThreadId) return null
        return state.threads[state.currentThreadId] || null
    },

    setStreamState: (streamState, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => {
            const thread = state.threads[targetId]
            if (!thread) return state

            return {
                threads: updateThreadEphemeral(state.threads, targetId, {
                    streamState: { ...thread.streamState, ...streamState },
                }),
            }
        })
    },

    setStreamPhase: (phase, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => {
            const thread = state.threads[targetId]
            if (!thread) return state

            const nextStreamState = phase === 'idle'
                ? {
                    ...thread.streamState,
                    phase,
                    currentToolCall: undefined,
                    error: undefined,
                    statusText: undefined,
                    requestId: undefined,
                    assistantId: undefined,
                }
                : { ...thread.streamState, phase }

            return {
                threads: updateThreadEphemeral(state.threads, targetId, {
                    streamState: nextStreamState,
                }),
            }
        })
    },

    setToolStreamingPreview: (toolCallId, preview, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => {
            const thread = state.threads[targetId]
            if (!thread) return state

            const currentPreview = thread.toolStreamingPreviews?.[toolCallId]
            const nextPreview: ToolStreamingPreview = {
                ...currentPreview,
                ...preview,
            }

            if (
                currentPreview?.isStreaming === nextPreview.isStreaming &&
                currentPreview?.name === nextPreview.name &&
                currentPreview?.lastUpdateTime === nextPreview.lastUpdateTime &&
                arePreviewArgsEqual(currentPreview?.partialArgs, nextPreview.partialArgs)
            ) {
                return state
            }

            return {
                threads: updateThreadEphemeral(state.threads, targetId, {
                    toolStreamingPreviews: {
                        ...(thread.toolStreamingPreviews || {}),
                        [toolCallId]: nextPreview,
                    },
                }),
            }
        })
    },

    clearToolStreamingPreview: (toolCallId, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => {
            const thread = state.threads[targetId]
            if (!thread?.toolStreamingPreviews?.[toolCallId]) return state

            const { [toolCallId]: _preview, ...rest } = thread.toolStreamingPreviews
            return {
                threads: updateThreadEphemeral(state.threads, targetId, {
                    toolStreamingPreviews: rest,
                }),
            }
        })
    },

    clearToolStreamingPreviews: (threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => {
            const thread = state.threads[targetId]
            if (!thread?.toolStreamingPreviews || Object.keys(thread.toolStreamingPreviews).length === 0) {
                return state
            }

            return {
                threads: updateThreadEphemeral(state.threads, targetId, {
                    toolStreamingPreviews: {},
                }),
            }
        })
    },

    getToolStreamingPreview: (toolCallId, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return undefined
        return get().threads[targetId]?.toolStreamingPreviews?.[toolCallId]
    },

    setCompressionStats: (stats, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThreadEphemeral(state.threads, targetId, { compressionStats: stats }),
        }))
    },

    setContextStats: (stats, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThreadEphemeral(state.threads, targetId, { contextStats: stats }),
        }))
    },

    setContextSummary: (summary, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThread(state.threads, targetId, { contextSummary: summary }),
        }))
    },

    setCompressionPhase: (phase, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThreadEphemeral(state.threads, targetId, { compressionPhase: phase }),
        }))
    },

    setHandoffRequired: (required, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThreadEphemeral(state.threads, targetId, { handoffRequired: required }),
        }))
    },

    setIsCompacting: (compacting, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThreadEphemeral(state.threads, targetId, { isCompacting: compacting }),
        }))
    },

    setTodos: (todos, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThread(state.threads, targetId, { todos }),
        }))
    },

    getTodos: (threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return []

        const thread = get().threads[targetId]
        return thread?.todos || []
    },

    setExecutionMeta: (meta, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThreadEphemeral(state.threads, targetId, { executionMeta: meta || { loopState: 'idle' } }),
        }))
    },

    updateExecutionMeta: (meta, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => {
            const thread = state.threads[targetId]
            if (!thread) return state

            return {
                threads: updateThreadEphemeral(state.threads, targetId, {
                    executionMeta: {
                        ...(thread.executionMeta || { loopState: 'idle' }),
                        ...meta,
                    },
                }),
            }
        })
    },

    clearExecutionMeta: (threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThreadEphemeral(state.threads, targetId, {
                executionMeta: { loopState: 'idle' },
                streamState: {
                    ...state.threads[targetId]?.streamState,
                    requestId: undefined,
                    assistantId: undefined,
                },
            }),
        }))
    },
})
