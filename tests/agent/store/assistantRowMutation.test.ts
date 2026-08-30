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

  it('行被截断时 startToolExecution 不写 phase：否则停不下来的 tool_running 会挂住整个会话', () => {
    const threadId = useAgentStore.getState().createThread()
    const phaseBefore = useAgentStore.getState().threads[threadId].streamState.phase

    useAgentStore.getState().startToolExecution('truncated-message', {
      id: 'tc-phase',
      name: 'read_file',
      arguments: {},
    }, {}, threadId)

    expect(useAgentStore.getState().threads[threadId].streamState.phase).toBe(phaseBefore)
  })

  it('startToolExecution 清掉这个工具的流式预览，其他工具的预览留着', () => {
    const threadId = useAgentStore.getState().createThread()
    const assistantId = useAgentStore.getState().addAssistantMessage()
    useAgentStore.getState().setToolStreamingPreview('tc-run', { isStreaming: true }, threadId)
    useAgentStore.getState().setToolStreamingPreview('tc-other', { isStreaming: true }, threadId)

    useAgentStore.getState().startToolExecution(assistantId, {
      id: 'tc-run',
      name: 'read_file',
      arguments: {},
    }, { requestId: 'req-1' }, threadId)

    const thread = useAgentStore.getState().threads[threadId]
    expect(thread.toolStreamingPreviews?.['tc-run']).toBeUndefined()
    expect(thread.toolStreamingPreviews?.['tc-other']).toBeDefined()
    expect(thread.streamState).toMatchObject({ phase: 'tool_running', requestId: 'req-1' })
  })

  it('行被截断时 finishToolExecution 不留孤儿 tool message，返回空 id', () => {
    const threadId = useAgentStore.getState().createThread()
    useAgentStore.getState().addUserMessage('hi', undefined, threadId)
    const countBefore = useAgentStore.getState().threads[threadId].messages.length

    const resultId = useAgentStore.getState().finishToolExecution('truncated-message', 'tc-gone', {
      status: 'success',
      result: 'ok',
    }, {
      name: 'read_file',
      content: 'ok',
      type: 'success',
    }, threadId)

    expect(resultId).toBe('')
    expect(useAgentStore.getState().threads[threadId].messages).toHaveLength(countBefore)
    expect(useAgentStore.getState().threads[threadId].messages.some(m => m.role === 'tool')).toBe(false)
  })

  it('行还在时照常落地工具终态与结果消息', () => {
    const threadId = useAgentStore.getState().createThread()
    const assistantId = useAgentStore.getState().addAssistantMessage()
    useAgentStore.getState().addToolCallPart(assistantId, {
      id: 'tc-done',
      name: 'read_file',
      arguments: {},
    }, threadId)

    const resultId = useAgentStore.getState().finishToolExecution(assistantId, 'tc-done', {
      status: 'success',
      result: 'file content',
    }, {
      name: 'read_file',
      content: 'file content',
      type: 'success',
    }, threadId)

    const messages = useAgentStore.getState().threads[threadId].messages
    expect(messages.at(-1)).toMatchObject({ id: resultId, role: 'tool', toolCallId: 'tc-done' })
    const assistant = messages.find(message => message.id === assistantId)
    if (assistant?.role !== 'assistant') throw new Error('assistant row missing')
    expect(assistant.toolCalls?.[0]).toMatchObject({ status: 'success', result: 'file content' })
  })

  it('updateToolCall 先落地缓冲里的正文，且那段文字只落地一次', () => {
    const threadId = useAgentStore.getState().createThread()
    const assistantId = useAgentStore.getState().addAssistantMessage()
    useAgentStore.getState().addToolCallPart(assistantId, {
      id: 'tc-flush',
      name: 'read_file',
      arguments: {},
    }, threadId)

    useAgentStore.getState().appendToAssistant(assistantId, 'tail text', threadId)
    useAgentStore.getState().updateToolCall(assistantId, 'tc-flush', { status: 'success', result: 'ok' }, threadId)
    // 缓冲已被排空，后续的定时 flush 不该把同一段文字再写一遍
    streamingBuffer.flushNow()

    const assistant = useAgentStore.getState().getMessages(threadId)
      .find(message => message.id === assistantId)
    if (assistant?.role !== 'assistant') throw new Error('assistant row missing')
    expect(assistant.content).toBe('tail text')
    expect(assistant.toolCalls?.[0]).toMatchObject({ status: 'success', result: 'ok' })
  })

  it('工具调用还没落地时 updateToolCall 不发布新版本', () => {
    const threadId = useAgentStore.getState().createThread()
    const assistantId = useAgentStore.getState().addAssistantMessage()
    const before = version(threadId)

    useAgentStore.getState().updateToolCall(assistantId, 'tc-missing', { status: 'success' }, threadId)

    expect(version(threadId)).toBe(before)
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
