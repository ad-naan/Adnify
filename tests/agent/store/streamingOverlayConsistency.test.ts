/**
 * 流式覆盖层与 `messages` 截断的一致性。
 *
 * 回归背景：正在流式输出的助手消息存在运行期覆盖层 `liveAssistantMessage` 里。
 * 回滚检查点 / 切分支会整体替换 `messages`，而这些入口都没有被 isStreaming 拦住，
 * 于是覆盖层可能指向一条已经不在 `messages` 里的消息。
 *
 * 早期实现下这是硬故障：finalizeAssistant 找不到目标就整体 return state，
 * `phase` 永久停在 'streaming' —— selectIsStreaming 恒为 true，
 * 持久化订阅整个会话不再落盘，新消息全被塞进发送队列且永不消费。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { selectIsStreaming, useAgentStore } from '@renderer/agent/store/AgentStore'
import { bumpThreadMessageVersion, withReplacedMessages } from '@renderer/agent/store/threadMessages'
import type { AssistantMessage, ChatMessage, ChatThread } from '@renderer/agent/types'

describe('finalizeAssistant 在消息已被截断时仍然收尾', () => {
  beforeEach(() => {
    useAgentStore.setState({ threads: {}, currentThreadId: null, threadMessageVersions: {} })
  })

  it('覆盖层指向的消息已不在 messages 里时，仍然退出 streaming', () => {
    const store = useAgentStore.getState()
    const threadId = store.createThread()
    store.addUserMessage('Hello')
    const assistantId = store.addAssistantMessage()

    expect(selectIsStreaming(useAgentStore.getState())).toBe(true)

    // 模拟回滚/切分支：把助手消息从 messages 里截掉，覆盖层悬空。
    useAgentStore.setState(state => ({
      threads: {
        ...state.threads,
        [threadId]: {
          ...state.threads[threadId],
          messages: state.threads[threadId].messages.filter(message => message.id !== assistantId),
        },
      },
    }))

    useAgentStore.getState().finalizeAssistant(assistantId)

    const thread = useAgentStore.getState().threads[threadId]
    expect(thread.liveAssistantMessage).toBeUndefined()
    expect(thread.streamState.phase).toBe('idle')
    expect(selectIsStreaming(useAgentStore.getState())).toBe(false)
    // 已经被截掉的消息不该被 finalize 重新塞回历史。
    expect(thread.messages.some(message => message.id === assistantId)).toBe(false)
  })

  it('消息仍在 messages 里时按原样写回终态', () => {
    const store = useAgentStore.getState()
    const threadId = store.createThread()
    const assistantId = store.addAssistantMessage('done')

    useAgentStore.getState().finalizeAssistant(assistantId)

    const thread = useAgentStore.getState().threads[threadId]
    const finalized = thread.messages.find(message => message.id === assistantId) as AssistantMessage
    expect(finalized.isStreaming).toBe(false)
    expect(thread.liveAssistantMessage).toBeUndefined()
    expect(thread.streamState.phase).toBe('idle')
  })
})

function makeThread(messages: ChatMessage[], live?: AssistantMessage): ChatThread {
  return {
    id: 'thread-1',
    title: 't',
    messages,
    createdAt: 0,
    lastModified: 0,
    liveAssistantMessage: live,
    streamState: { phase: 'streaming' },
  } as unknown as ChatThread
}

function assistant(id: string): AssistantMessage {
  return { id, role: 'assistant', content: '', timestamp: 0, isStreaming: true, parts: [], toolCalls: [] }
}

describe('withReplacedMessages', () => {
  it('覆盖层的消息被截掉时收回覆盖层并回到 idle', () => {
    const live = assistant('a1')
    const thread = makeThread([{ id: 'u1', role: 'user' } as ChatMessage, live], live)

    const patch = withReplacedMessages(thread, [{ id: 'u1', role: 'user' } as ChatMessage])

    expect(patch.liveAssistantMessage).toBeUndefined()
    expect(patch.streamState.phase).toBe('idle')
  })

  it('覆盖层的消息仍然存在时保持不动（切分支可能只是换了顺序）', () => {
    const live = assistant('a1')
    const messages = [live, { id: 'u1', role: 'user' } as ChatMessage]
    const thread = makeThread([{ id: 'u1', role: 'user' } as ChatMessage, live], live)

    const patch = withReplacedMessages(thread, messages)

    expect(patch.liveAssistantMessage).toBe(live)
    expect(patch.streamState.phase).toBe('streaming')
    expect(patch.messages).toBe(messages)
  })

  it('没有覆盖层时只替换 messages', () => {
    const thread = makeThread([{ id: 'u1', role: 'user' } as ChatMessage])

    const patch = withReplacedMessages(thread, [])

    expect(patch.messages).toEqual([])
    expect(patch.liveAssistantMessage).toBeUndefined()
    expect(patch.streamState.phase).toBe('streaming')
  })
})

describe('bumpThreadMessageVersion', () => {
  it('从缺省值开始递增', () => {
    expect(bumpThreadMessageVersion({}, 'a')).toEqual({ a: 1 })
    expect(bumpThreadMessageVersion({ a: 3, b: 1 }, 'a')).toEqual({ a: 4, b: 1 })
  })
})

/**
 * 收尾之后到达的流式更新。
 *
 * 用户按停止时 Agent.stop() 会立刻 finalizeAssistant，而 IPC 上的流事件监听
 * 还没摘掉；随后到达的 token 和检索结果收尾（retrievalService.finalizeUI）
 * 打的都是一条已经 isStreaming: false 的消息。
 *
 * 这类更新绝不能再写进覆盖层：覆盖层只在消息仍在流式时会被渲染
 * （见 chatMessageLiveSelector），但 materializeThreadMessages 照样会把它
 * 写进 SQLite 和发给模型的历史 —— 界面上看不见、库里存下来了、模型也看见了，
 * 重启后那段内容还会突然冒出来。
 */
describe('收尾后的更新直接落进 messages', () => {
  beforeEach(() => {
    useAgentStore.setState({ threads: {}, currentThreadId: null, threadMessageVersions: {} })
  })

  it('finalize 之后的文本追加可见、并发布新的消息版本', () => {
    const store = useAgentStore.getState()
    const threadId = store.createThread()
    const assistantId = store.addAssistantMessage('seen')
    useAgentStore.getState().finalizeAssistant(assistantId)

    const versionBefore = useAgentStore.getState().threadMessageVersions[threadId]
    useAgentStore.getState()._doAppendToAssistant(assistantId, ' late')

    const state = useAgentStore.getState()
    const thread = state.threads[threadId]
    const message = thread.messages.find(item => item.id === assistantId) as AssistantMessage
    expect(message.content).toBe('seen late')
    expect(thread.liveAssistantMessage).toBeUndefined()
    expect(state.threadMessageVersions[threadId]).toBe(versionBefore + 1)
    expect(thread.streamState.phase).toBe('idle')
  })

  it('finalize 之后的检索收尾同样落进 messages', () => {
    const store = useAgentStore.getState()
    const threadId = store.createThread()
    const assistantId = store.addAssistantMessage('')
    const partId = useAgentStore.getState().addSearchPart(assistantId)
    useAgentStore.getState().finalizeAssistant(assistantId)

    useAgentStore.getState().updateSearchPart(assistantId, partId, 'Found 2 relevant files:', false, false)
    useAgentStore.getState().finalizeSearchPart(assistantId, partId)

    const thread = useAgentStore.getState().threads[threadId]
    const message = thread.messages.find(item => item.id === assistantId) as AssistantMessage
    const searchPart = message.parts.find(part => part.type === 'search')
    expect(searchPart).toMatchObject({ content: 'Found 2 relevant files:', isStreaming: false })
    expect(thread.liveAssistantMessage).toBeUndefined()
  })

  it('流式期间仍然只更新覆盖层，不发布新的消息版本', () => {
    const store = useAgentStore.getState()
    const threadId = store.createThread()
    const assistantId = store.addAssistantMessage('a')

    const versionBefore = useAgentStore.getState().threadMessageVersions[threadId]
    useAgentStore.getState()._doAppendToAssistant(assistantId, 'b')

    const state = useAgentStore.getState()
    const thread = state.threads[threadId]
    expect(thread.liveAssistantMessage?.content).toBe('ab')
    expect((thread.messages.find(item => item.id === assistantId) as AssistantMessage).content).toBe('a')
    expect(state.threadMessageVersions[threadId]).toBe(versionBefore)
  })

  it('消息已被截掉时丢弃收尾后的更新，不复活它', () => {
    const store = useAgentStore.getState()
    const threadId = store.createThread()
    const assistantId = store.addAssistantMessage('seen')
    useAgentStore.getState().finalizeAssistant(assistantId)
    useAgentStore.setState(state => ({
      threads: {
        ...state.threads,
        [threadId]: {
          ...state.threads[threadId],
          messages: state.threads[threadId].messages.filter(message => message.id !== assistantId),
        },
      },
    }))

    useAgentStore.getState()._doAppendToAssistant(assistantId, ' late')

    const thread = useAgentStore.getState().threads[threadId]
    expect(thread.messages.some(message => message.id === assistantId)).toBe(false)
    expect(thread.liveAssistantMessage).toBeUndefined()
  })
})
