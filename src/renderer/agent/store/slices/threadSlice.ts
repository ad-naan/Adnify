/**
 * Thread slice.
 * Owns thread lifecycle plus thread-scoped ephemeral streaming preview state.
 */

import type { StateCreator } from 'zustand'
import type { ChatThread, StreamState, CompressionPhase, TodoItem, ContextStats, ThreadHandoffState } from '../../types'
import type { LastActiveServer } from '../../types'
import type { CompressionStats } from '../../core/types'
import type { StructuredSummary } from '../../domains/context/types'
import type { BranchSlice } from './branchSlice'
import type { ToolStreamingPreview } from '@/shared/types'
import { agentSessionRepository } from '@/renderer/services/agentSessionRepository'
import { createIdleHandoffState, createRuntimeThreadState } from '../../types'
import { findMostRecentThreadForMode } from '../../threads/threadModeProjection'
import { normalizeMode } from '@/shared/types/workMode'
import { logger } from '@utils/Logger'

export interface ThreadStoreState {
    threads: Record<string, ChatThread>
    currentThreadId: string | null
    threadMessageVersions: Record<string, number>
}

export interface ThreadActions {
    createThread: (options?: {
        activate?: boolean
        mode?: ChatThread['mode']
        origin?: ChatThread['origin']
        planId?: string
        taskId?: string
        parentThreadId?: string
        rootThreadId?: string
    }) => string
    renameThread: (threadId: string, title: string) => boolean
    switchThread: (threadId: string) => void
    deleteThread: (threadId: string) => void
    getCurrentThread: () => ChatThread | null
    setThreadMetadata: (threadId: string, metadata: Pick<ChatThread, 'mode' | 'origin' | 'planId' | 'taskId' | 'parentThreadId' | 'rootThreadId'>) => void

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
    setHandoffState: (handoff: ThreadHandoffState, threadId?: string) => void
    clearHandoffState: (threadId?: string) => void
    dismissLaneNotice: (threadId?: string | null) => void
    setIsCompacting: (compacting: boolean, threadId?: string) => void

    setTodos: (todos: TodoItem[], threadId?: string) => void
    getTodos: (threadId?: string) => TodoItem[]
    setLastActiveServer: (server: LastActiveServer | null, threadId?: string) => void
    clearLastActiveServer: (threadId?: string) => void
    setExecutionMeta: (meta: import('../../types').ThreadExecutionMeta | null, threadId?: string) => void
    updateExecutionMeta: (meta: Partial<import('../../types').ThreadExecutionMeta>, threadId?: string) => void
    clearExecutionMeta: (threadId?: string) => void
}

export type ThreadSlice = ThreadStoreState & ThreadActions

const generateId = () => crypto.randomUUID()

function deletePersistedThread(threadId: string): void {
    void agentSessionRepository.deleteThread(threadId).catch(error => {
        // The next staged snapshot still contains the deletion diff, so the
        // shared commit queue will retry it instead of losing the operation.
        logger.agent.error('[ThreadSlice] Immediate thread deletion failed:', error)
    })
}

export const createEmptyThread = (metadata?: Pick<ChatThread, 'mode' | 'origin' | 'planId' | 'taskId' | 'parentThreadId' | 'rootThreadId'>): ChatThread => ({
    id: generateId(),
    createdAt: Date.now(),
    lastModified: Date.now(),
    messages: [],
    messagesHydrated: true,
    contextItems: [],
    messageCheckpoints: [],
    contextSummary: null,
    ...metadata,
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

/**
 * How many threads keep their message bodies in memory.
 *
 * Threads are capped at 50 and each stores up to 1000 messages, so a long
 * session can hold tens of thousands of message objects — including tool results
 * and base64 images — for conversations the user is not looking at. Message
 * bodies live on disk (SQLite) and `switchThread` already re-hydrates lazily, so
 * anything outside this window is recoverable.
 */
const HYDRATED_THREAD_LIMIT = 6

/**
 * A thread must not be unloaded while it is doing work: background plan tasks
 * and sub-agents append to threads the user is not viewing, and the agent loop
 * reads their messages to extract output.
 */
function isThreadBusy(thread: ChatThread): boolean {
    return thread.streamState.phase !== 'idle'
        || thread.executionMeta?.loopState === 'running'
        || thread.isCompacting === true
}

/**
 * Pick hydrated, idle threads to unload, keeping the most recently touched ones.
 *
 * `keepThreadId` is the thread being switched to — it is about to be rendered.
 */
function selectThreadsToUnload(
    threads: Record<string, ChatThread>,
    keepThreadId: string | null,
): string[] {
    const candidates = Object.values(threads)
        .filter(thread => thread.id !== keepThreadId
            && thread.messagesHydrated !== false
            && thread.messages.length > 0
            && !isThreadBusy(thread))
        .sort((a, b) => b.lastModified - a.lastModified)

    // The kept thread occupies one slot in the window.
    const budget = keepThreadId ? HYDRATED_THREAD_LIMIT - 1 : HYDRATED_THREAD_LIMIT
    return candidates.slice(Math.max(0, budget)).map(thread => thread.id)
}

export const createThreadSlice: StateCreator<
    ThreadSlice & BranchSlice,
    [],
    [],
    ThreadSlice
> = (set, get) => {
    /**
     * Release message bodies for threads outside the hydration window.
     *
     * Marking `messagesHydrated: false` is what lets `switchThread` re-load them
     * later, and it also tells the persistence layer to leave the on-disk history
     * alone for that thread. Skipped entirely if the repository still has an
     * uncommitted patch, since that patch is the only copy of those writes.
     */
    const unloadColdThreadMessages = (keepThreadId: string | null): void => {
        const staleIds = selectThreadsToUnload(get().threads, keepThreadId)
        if (staleIds.length === 0) return

        const released = staleIds.filter(id => agentSessionRepository.releaseThreadMessages(id))
        if (released.length === 0) return

        set(state => {
            const threads = { ...state.threads }
            for (const id of released) {
                const thread = threads[id]
                // Re-check: `set` runs after the async gap above.
                if (!thread || thread.messagesHydrated === false || isThreadBusy(thread)) continue
                threads[id] = {
                    ...thread,
                    messages: [],
                    messagesHydrated: false,
                    messageCount: thread.messages.length,
                }
            }
            return { threads }
        })
        logger.agent.info(`[ThreadSlice] Unloaded messages for ${released.length} cold thread(s)`)
    }

    return {
    threads: {},
    currentThreadId: null,
    threadMessageVersions: {},

    createThread: (options) => {
        const thread = createEmptyThread({
            mode: options?.mode,
            origin: options?.origin,
            planId: options?.planId,
            taskId: options?.taskId,
            parentThreadId: options?.parentThreadId,
            rootThreadId: options?.rootThreadId,
        })
        const activate = options?.activate ?? true
        const evictedThreadIds: string[] = []
        set(state => {
            const newThreads = { ...state.threads, [thread.id]: thread }
            let newBranches = state.branches
            let newActiveBranch = state.activeBranchId
            let newMessageVersions = {
                ...state.threadMessageVersions,
                [thread.id]: 0,
            }

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
                newMessageVersions = { ...newMessageVersions }

                for (const { id } of toDelete) {
                    delete newThreads[id]
                    delete newBranches[id]
                    delete newActiveBranch[id]
                    // Previously leaked: the version counter outlived its thread.
                    delete newMessageVersions[id]
                    evictedThreadIds.push(id)
                }
            }

            return {
                threads: newThreads,
                currentThreadId: activate ? thread.id : state.currentThreadId,
                threadMessageVersions: newMessageVersions,
                branches: newBranches,
                activeBranchId: newActiveBranch,
            }
        })

        // FIFO eviction used to drop threads from the in-memory map only, leaving
        // their persisted rows orphaned forever — a permanent
        // leak that plan mode makes worse, since every plan task burns a slot.
        // `deleteThread` has always cleaned up disk; eviction now does too.
        for (const evictedId of evictedThreadIds) {
            deletePersistedThread(evictedId)
        }

        return thread.id
    },

    renameThread: (threadId, title) => {
        const trimmedTitle = title.trim()
        if (!trimmedTitle) return false

        let renamed = false

        set(state => {
            const thread = state.threads[threadId]
            if (!thread || thread.title === trimmedTitle) {
                return state
            }

            renamed = true
            return {
                threads: updateThread(state.threads, threadId, {
                    title: trimmedTitle,
                }),
            }
        })

        return renamed
    },

    setThreadMetadata: (threadId, metadata) => {
        set(state => ({
            threads: updateThread(state.threads, threadId, metadata),
        }))
    },

    switchThread: (threadId) => {
        const state = get()
        if (!state.threads[threadId]) return
        if (state.currentThreadId === threadId) return
        set({ currentThreadId: threadId })

        // Free the message bodies of threads that fell out of the hydration
        // window. Done on switch rather than on a timer so it never races with an
        // in-flight render, and always after currentThreadId moved so the new
        // thread is never a candidate.
        unloadColdThreadMessages(threadId)

        // Lazily hydrate both messages and normalized branch messages.
        const thread = state.threads[threadId]
        if (thread && (thread.messagesHydrated === false ||
            !agentSessionRepository.areThreadBranchesHydrated(threadId))) {
            Promise.all([
                thread.messagesHydrated === false
                    ? agentSessionRepository.loadThreadMessages(threadId)
                    : Promise.resolve(thread.messages),
                agentSessionRepository.areThreadBranchesHydrated(threadId)
                    ? Promise.resolve(state.branches[threadId] || [])
                    : agentSessionRepository.loadThreadBranches(threadId),
            ]).then(([messages, branches]) => {
                // 无论消息是否为空，都触发一次 set，确保 ChatPanel 的 useEffect
                // 检测到 filteredMessages 引用变化，能正常退出骨架屏状态
                set(state => ({
                    threads: {
                        ...state.threads,
                        [threadId]: {
                            ...state.threads[threadId],
                            messages,
                            messagesHydrated: true,
                            hydrationFailed: false,
                            messageCount: messages.length,
                        },
                    },
                    branches: {
                        ...state.branches,
                        [threadId]: branches,
                    },
                }))
            }).catch(err => {
                logger.agent.error('[ThreadSlice] Failed to load messages:', err)
                // 加载失败时只标记失败，让骨架屏能退出，但绝不写入空消息列表：
                // messagesHydrated 必须保持 false，否则持久化层会把读取失败
                // 误判为真实的空历史，并提交删除事务。
                set(state => ({
                    threads: {
                        ...state.threads,
                        [threadId]: {
                            ...state.threads[threadId],
                            hydrationFailed: true,
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
            const replacementThread = findMostRecentThreadForMode(Object.values(remaining), normalizeMode(_thread.mode))
            const { [threadId]: _messageVersion, ...remainingMessageVersions } = state.threadMessageVersions
            const { [threadId]: _branch, ...remainingBranches } = state.branches || {}
            const { [threadId]: _activeBranch, ...remainingActiveBranch } = state.activeBranchId || {}
            didDelete = true

            return {
                threads: remaining,
                currentThreadId: state.currentThreadId === threadId
                    ? (replacementThread?.id || null)
                    : state.currentThreadId,
                threadMessageVersions: remainingMessageVersions,
                branches: remainingBranches,
                activeBranchId: remainingActiveBranch,
            }
        })

        if (didDelete) {
            deletePersistedThread(threadId)
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
                    pendingToolCalls: undefined,
                    error: undefined,
                    statusText: undefined,
                    requestId: undefined,
                    assistantId: undefined,
                    laneNotice: undefined,
                }
                : { ...thread.streamState, phase }

            return {
                threads: updateThreadEphemeral(state.threads, targetId, {
                    streamState: nextStreamState,
                }),
            }
        })
    },

    dismissLaneNotice: (threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => {
            const thread = state.threads[targetId]
            if (!thread?.streamState?.laneNotice) return state

            return {
                threads: updateThreadEphemeral(state.threads, targetId, {
                    streamState: { ...thread.streamState, laneNotice: undefined },
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

    setHandoffState: (handoff, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThreadEphemeral(state.threads, targetId, { handoff }),
        }))
    },

    clearHandoffState: (threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThreadEphemeral(state.threads, targetId, { handoff: createIdleHandoffState() }),
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

    setLastActiveServer: (server, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThread(state.threads, targetId, {
                lastActiveServer: server || undefined,
            }),
        }))
    },

    clearLastActiveServer: (threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThread(state.threads, targetId, {
                lastActiveServer: undefined,
            }),
        }))
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
    }
}
