/**
 * ChatMessage 的 live-state selector
 *
 * 从 ChatMessage.tsx 里提出来，原因有两个：一是它有个引用稳定性的 bug 需要被
 * 测试覆盖，二是这个仓库不做组件渲染测试（vitest environment: 'node'，全项目
 * 零 .test.tsx），提成纯函数是能测它的唯一低成本方式。
 *
 * ── 原来的 bug ──
 * selector 无条件返回 `liveMessage.parts`（一个数组引用）。流式期间每个 token
 * 都会不可变地重建 parts 数组，引用每 33ms 变一次，useShallow 的一层浅比较
 * 必然判定「变了」。于是每条可见消息都重渲染 —— overscan={12}，也就是 12 条 ×
 * 每秒 30 次，即使只有一条在流式。React.memo 拦不住，因为重渲染是组件自己的
 * store 订阅触发的，跟 props 无关。
 *
 * 每条消息还各自在 selector 里做一次 messages.find() 线性查找，成本同样翻 12 倍。
 *
 * ── 修法 ──
 * 只有「当前正在流式的那一条」需要 live parts。其余消息的 parts 已经落库、不再
 * 变化，直接返回 undefined，组件会回退到 message.parts（一个稳定引用）。这样
 * 静态消息的 selector 结果逐字段全等，useShallow 判定无变化，重渲染被切断。
 *
 * 先判断 isActiveAssistant 再取 parts，也顺带省掉了静态消息那次 find()。
 */

import type { AssistantPart } from '@renderer/agent/types'
import type { InteractiveContent } from '@renderer/agent/types/interactive'
import type { ToolStreamingPreview } from '@shared/types'

const EMPTY_PREVIEWS: Record<string, ToolStreamingPreview> = {}

/** 这些 phase 才算「流式进行中」 */
export const ACTIVE_STREAM_PHASES = new Set(['streaming', 'tool_running', 'tool_pending'])

/**
 * selector 只依赖 store 的这几个字段。写成窄接口而不是引用整个 AgentStore
 * 类型，是为了让测试能构造最小的假 state，而不必拼出整个 store。
 */
export interface LiveSelectorState {
  currentThreadId?: string | null
  threads: Record<
    string,
    | {
        streamState?: { assistantId?: string; phase?: string }
        messages?: ReadonlyArray<{
          id: string
          role: string
          parts?: AssistantPart[]
          interactive?: InteractiveContent
        }>
        toolStreamingPreviews?: Record<string, ToolStreamingPreview>
      }
    | undefined
  >
}

export interface LiveSelectorResult {
  isStreaming: boolean
  previewMap: Record<string, ToolStreamingPreview>
  liveParts: AssistantPart[] | undefined
  liveInteractive: InteractiveContent | undefined
}

/** 非流式情况的固定结果——每次返回同一批引用，浅比较恒等 */
const INERT: LiveSelectorResult = {
  isStreaming: false,
  previewMap: EMPTY_PREVIEWS,
  liveParts: undefined,
  liveInteractive: undefined,
}

export function selectLiveState(
  state: LiveSelectorState,
  messageId: string,
  isAssistant: boolean,
  messageIsStreaming: boolean,
): LiveSelectorResult {
  if (!isAssistant) return INERT

  const threadId = state.currentThreadId
  const thread = threadId ? state.threads[threadId] : undefined
  const streamState = thread?.streamState

  const isActiveAssistant =
    Boolean(messageIsStreaming) &&
    !!threadId &&
    streamState?.assistantId === messageId &&
    ACTIVE_STREAM_PHASES.has(streamState?.phase ?? 'idle')

  // 不在流式中：parts 已经定稿，不要订阅 live 引用。返回 undefined 让组件用
  // message.parts（稳定引用），并跳过下面那次 find()。
  if (!isActiveAssistant) return INERT

  const liveMessage = thread?.messages?.find(
    msg => msg.id === messageId && msg.role === 'assistant',
  )

  return {
    isStreaming: true,
    liveParts: liveMessage?.parts,
    liveInteractive: liveMessage?.interactive,
    previewMap: thread?.toolStreamingPreviews || EMPTY_PREVIEWS,
  }
}
