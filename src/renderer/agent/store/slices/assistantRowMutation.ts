/**
 * 助手行的唯一写入通道。
 *
 * 「助手行」= 时间线里那条 `role === 'assistant'` 的消息。流式期间它有两个可能的载体：
 * `thread.messages[i]` 里的已落地快照，和 `thread.liveAssistantMessage` 这个覆盖层
 * （token 只改动活跃那一行，不发布新的 messages 版本，ChatPanel 因此不必重扫长历史；
 * 完整的覆盖层不变量见 messageSlice 里 `publishAssistantMessage` 的注释）。
 *
 * 结构性写入（加工具调用 part、工具执行开始/结束、工具调用前收尾正文）必须读**合成后**
 * 的那一条：直接改 `thread.messages` 里的旧快照，下一次 materialize 就会用覆盖层把整条
 * 消息盖回去，这次写入凭空消失。五个 mutation 以前各写一遍这套顺序，于是在六个维度上
 * 互不一致（刷不刷缓冲、读不读覆盖层、行不存在时放弃还是照写、bump 不 bump 版本……）。
 * 其中两个不一致是真 bug：行被截断时仍然 push 工具结果，留下没有父消息的 tool message；
 * 以及改了 `messages` 引用却不 bump 版本，流式期间那次改动**看不见**。
 *
 * 所以这里把顺序固定成一条：
 *   1. 在 updater **之外**排空这条消息的流式缓冲（顺序：先落地正文，再改 parts）
 *   2. `materializeThreadMessages` 一次，在合成结果上找行
 *   3. 找不到（回滚检查点 / 切分支截断了历史）→ 整体放弃：不追加、不 bump、不清覆盖层
 *   4. `edit` 返回同引用 = 未改，返回 `null` = 放弃
 *   5. 真的有事要做才提交：写回 messages + bump 版本 + 落地覆盖层 + 合并 streamState
 *      + 清工具预览 + 写 lastModified
 */

import type { AssistantMessage, ChatMessage, ChatThread, StreamState } from '../../types'
import { materializeThreadMessages } from '../../types'
import { bumpThreadMessageVersion } from '../threadMessages'
import { assertOutsideStoreUpdater, runStoreUpdater } from '../storeUpdaterGuard'

/** 这个 helper 需要的最小 store 形状，避免和整份 AgentStore 类型互相牵连 */
export interface AssistantRowStoreState {
    threads: Record<string, ChatThread>
    threadMessageVersions: Record<string, number>
    _flushTextBuffer: (messageId: string) => void
}

type AssistantRowStorePatch = Partial<AssistantRowStoreState>

export type AssistantRowSet = (
    partial:
        | AssistantRowStoreState
        | AssistantRowStorePatch
        | ((state: AssistantRowStoreState) => AssistantRowStoreState | AssistantRowStorePatch)
) => void

export type AssistantRowGet = () => AssistantRowStoreState

export interface AssistantRowMutation {
    threadId: string
    messageId: string
    /** 在合成后的那条助手消息上返回新版本；同引用 = 未改，`null` = 放弃这次写入 */
    edit: (message: AssistantMessage) => AssistantMessage | null
    /** 一起追加到时间线末尾的消息（工具结果）。行不存在时同样整体放弃，不留孤儿 */
    append?: ChatMessage[]
    /** 合并进 `thread.streamState` 的字段 */
    streamState?: Partial<StreamState>
    /** 要一并清掉的工具流式预览 id */
    dropPreviews?: string[]
    /** 是否顺带更新 `thread.lastModified` */
    touchLastModified?: boolean
}

function dropToolStreamingPreviews(
    thread: ChatThread,
    previewIds: string[]
): ChatThread['toolStreamingPreviews'] {
    const previews = thread.toolStreamingPreviews
    if (!previews) return previews

    const present = previewIds.filter(id => previews[id])
    if (present.length === 0) return previews

    return Object.fromEntries(Object.entries(previews).filter(([id]) => !present.includes(id)))
}

/**
 * 按上面那条固定顺序改一条助手行。
 *
 * @returns 是否真的提交了这次写入（`false` = 线程/行不存在，或者无事可做）
 */
export function mutateAssistantRow(
    set: AssistantRowSet,
    get: AssistantRowGet,
    mutation: AssistantRowMutation
): boolean {
    const { threadId, messageId, edit, append, streamState, dropPreviews, touchLastModified } = mutation

    assertOutsideStoreUpdater('mutateAssistantRow')

    // 必须在 updater 之外：它内部会走 _doAppendToAssistant → set()
    get()._flushTextBuffer(messageId)

    let committed = false

    set(state => runStoreUpdater(() => {
        const thread = state.threads[threadId]
        if (!thread) return state

        const materialized = materializeThreadMessages(thread)
        const rowIndex = materialized.findIndex(
            message => message.id === messageId && message.role === 'assistant'
        )
        // 行已被截断（回滚检查点 / 切分支）：不能把它复活，追加的工具结果也不能留下
        if (rowIndex === -1) return state

        const currentRow = materialized[rowIndex] as AssistantMessage
        const nextRow = edit(currentRow)
        if (nextRow === null) return state

        const rowChanged = nextRow !== currentRow
        const nextPreviews = dropPreviews ? dropToolStreamingPreviews(thread, dropPreviews) : thread.toolStreamingPreviews
        const hasOtherWork =
            (append?.length ?? 0) > 0 ||
            streamState !== undefined ||
            nextPreviews !== thread.toolStreamingPreviews
        if (!rowChanged && !hasOtherWork) return state

        // 提交时总是写回合成结果并落地覆盖层：只清覆盖层却不写 messages 会丢内容
        const messages = materialized.slice()
        messages[rowIndex] = nextRow
        if (append?.length) {
            messages.push(...append)
        }

        committed = true

        return {
            threadMessageVersions: bumpThreadMessageVersion(state.threadMessageVersions, threadId),
            threads: {
                ...state.threads,
                [threadId]: {
                    ...thread,
                    messages,
                    liveAssistantMessage: undefined,
                    toolStreamingPreviews: nextPreviews,
                    ...(streamState ? { streamState: { ...thread.streamState, ...streamState } } : {}),
                    ...(touchLastModified ? { lastModified: Date.now() } : {}),
                },
            },
        }
    }))

    return committed
}
