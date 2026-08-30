/**
 * 助手行唯一写入通道的不变量测试。
 *
 * 这些不变量以前分散在五个 mutation 里各写一遍、且互不一致：行被截断时有的放弃、有的
 * 照写；未改动时有的不 bump 版本、有的照 bump（于是流式期间白发一次时间线版本）。
 * 收口到 mutateAssistantRow 之后，它们变成一处可断言的行为。
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { useAgentStore } from '@renderer/agent/store/AgentStore'
import { streamingBuffer } from '@renderer/agent/store/StreamingBuffer'
import { assertOutsideStoreUpdater, runStoreUpdater } from '@renderer/agent/store/storeUpdaterGuard'

const version = (threadId: string) => useAgentStore.getState().threadMessageVersions[threadId] || 0

describe('mutateAssistantRow', () => {
  beforeEach(() => {
    streamingBuffer.clear()
    useAgentStore.setState({ threads: {}, currentThreadId: null, threadMessageVersions: {} })
  })

  it('行不存在时整体放弃：不 bump 版本，也不改任何状态', () => {
    const threadId = useAgentStore.getState().createThread()
    const before = version(threadId)
    const threadBefore = useAgentStore.getState().threads[threadId]

    useAgentStore.getState().addToolCallPart('truncated-message', {
      id: 'tc-orphan',
      name: 'read_file',
      arguments: {},
    }, threadId)

    expect(version(threadId)).toBe(before)
    expect(useAgentStore.getState().threads[threadId]).toBe(threadBefore)
  })

  it('未改动时不发布新版本（重复宣告同一个工具调用）', () => {
    const threadId = useAgentStore.getState().createThread()
    const assistantId = useAgentStore.getState().addAssistantMessage()
    const toolCall = { id: 'tc-dup', name: 'read_file', arguments: { path: 'a.ts' } }

    useAgentStore.getState().addToolCallPart(assistantId, toolCall, threadId)
    const afterFirst = version(threadId)
    const messagesAfterFirst = useAgentStore.getState().threads[threadId].messages

    useAgentStore.getState().addToolCallPart(assistantId, toolCall, threadId)

    expect(version(threadId)).toBe(afterFirst)
    expect(useAgentStore.getState().threads[threadId].messages).toBe(messagesAfterFirst)
  })

  it('先落地缓冲里的正文，再追加工具调用 part（顺序不能反）', () => {
    const threadId = useAgentStore.getState().createThread()
    const assistantId = useAgentStore.getState().addAssistantMessage()

    // 走公开的 appendToAssistant，正文此刻还压在 StreamingBuffer 里
    useAgentStore.getState().appendToAssistant(assistantId, 'before the tool', threadId)
    useAgentStore.getState().addToolCallPart(assistantId, {
      id: 'tc-order',
      name: 'read_file',
      arguments: {},
    }, threadId)

    const assistant = useAgentStore.getState().getMessages(threadId)
      .find(message => message.id === assistantId)
    expect(assistant?.role).toBe('assistant')
    if (assistant?.role !== 'assistant') return
    expect(assistant.parts.map(part => part.type)).toEqual(['text', 'tool_call'])
    expect(assistant.content).toBe('before the tool')
  })

  it('落地的工具调用不带流式预览状态（streamingState 不进持久化）', () => {
    const threadId = useAgentStore.getState().createThread()
    const assistantId = useAgentStore.getState().addAssistantMessage()

    useAgentStore.getState().addToolCallPart(assistantId, {
      id: 'tc-clean',
      name: 'read_file',
      arguments: {},
      streamingState: { isStreaming: true },
    }, threadId)

    const assistant = useAgentStore.getState().getMessages(threadId)
      .find(message => message.id === assistantId)
    if (assistant?.role !== 'assistant') throw new Error('assistant row missing')
    expect(assistant.toolCalls?.[0].streamingState).toBeUndefined()
  })
})

describe('storeUpdaterGuard', () => {
  it('updater 内部调用会抛错，而不是静默盖掉内层写入', () => {
    expect(() => runStoreUpdater(() => assertOutsideStoreUpdater('_flushTextBuffer'))).toThrow(/set\(\)/)
  })

  it('updater 之外照常放行，且退出后深度归零', () => {
    runStoreUpdater(() => undefined)
    expect(() => assertOutsideStoreUpdater('_flushTextBuffer')).not.toThrow()
  })

  it('抛错也要把深度还回去（finally）', () => {
    expect(() => runStoreUpdater(() => { throw new Error('boom') })).toThrow('boom')
    expect(() => assertOutsideStoreUpdater('_flushTextBuffer')).not.toThrow()
  })
})
