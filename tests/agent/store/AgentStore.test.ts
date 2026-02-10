/**
 * AgentStore 测试
 * 测试状态管理和消息操作
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useAgentStore } from '@renderer/agent/store/AgentStore'

describe('AgentStore', () => {
  beforeEach(() => {
    // 重置 store
    useAgentStore.setState({
      threads: {},
      currentThreadId: null,
    })
  })

  describe('Thread Management', () => {
    it('should create new thread', () => {
      const threadId = useAgentStore.getState().createThread()
      const store = useAgentStore.getState()

      expect(threadId).toBeDefined()
      expect(store.threads[threadId]).toBeDefined()
      expect(store.currentThreadId).toBe(threadId)
    })

    it('should switch between threads', () => {
      const thread1 = useAgentStore.getState().createThread()
      const thread2 = useAgentStore.getState().createThread()
      let store = useAgentStore.getState()

      expect(store.currentThreadId).toBe(thread2)

      store.switchThread(thread1)
      store = useAgentStore.getState()
      expect(store.currentThreadId).toBe(thread1)
    })

    it('should delete thread', () => {
      const store = useAgentStore.getState()
      const threadId = store.createThread()

      store.deleteThread(threadId)
      expect(store.threads[threadId]).toBeUndefined()
    })

    it('should get current thread', () => {
      const store = useAgentStore.getState()
      const threadId = store.createThread()

      const thread = store.getCurrentThread()
      expect(thread).toBeDefined()
      expect(thread?.id).toBe(threadId)
    })
  })

  describe('Message Management', () => {
    it('should add user message', () => {
      const store = useAgentStore.getState()
      store.createThread()

      const messageId = store.addUserMessage('Hello')
      const messages = store.getMessages()

      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe(messageId)
      expect(messages[0].role).toBe('user')
      expect((messages[0] as any).content).toBe('Hello')
    })

    it('should add assistant message', () => {
      const store = useAgentStore.getState()
      store.createThread()

      const messageId = store.addAssistantMessage('Hi there')
      const messages = store.getMessages()

      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe(messageId)
      expect(messages[0].role).toBe('assistant')
      expect((messages[0] as any).content).toBe('Hi there')
    })

    it('should update message', () => {
      const store = useAgentStore.getState()
      store.createThread()

      const messageId = store.addUserMessage('Hello')
      store.updateMessage(messageId, { content: 'Updated' })

      const messages = store.getMessages()
      expect((messages[0] as any).content).toBe('Updated')
    })

    it('should clear messages', () => {
      const store = useAgentStore.getState()
      store.createThread()

      store.addUserMessage('Hello')
      store.addAssistantMessage('Hi')

      store.clearMessages()
      const messages = store.getMessages()
      expect(messages).toHaveLength(0)
    })
  })

  describe('Tool Call Management', () => {
    it('should add tool call part', () => {
      const store = useAgentStore.getState()
      store.createThread()

      const assistantId = store.addAssistantMessage()
      store.addToolCallPart(assistantId, {
        id: 'tc1',
        name: 'read_file',
        arguments: { path: 'test.ts' },
      })

      const messages = store.getMessages()
      const assistant = messages[0] as any
      expect(assistant.toolCalls).toHaveLength(1)
      expect(assistant.toolCalls[0].name).toBe('read_file')
    })

    it('should update tool call', () => {
      const store = useAgentStore.getState()
      store.createThread()

      const assistantId = store.addAssistantMessage()
      store.addToolCallPart(assistantId, {
        id: 'tc1',
        name: 'read_file',
        arguments: { path: 'test.ts' },
      })

      store.updateToolCall(assistantId, 'tc1', {
        status: 'success',
        result: 'File content',
      })

      const messages = store.getMessages()
      const assistant = messages[0] as any
      expect(assistant.toolCalls[0].status).toBe('success')
      expect(assistant.toolCalls[0].result).toBe('File content')
    })
  })

  describe('Context Items', () => {
    it('should add context item', () => {
      const store = useAgentStore.getState()
      store.createThread()

      store.addContextItem({ type: 'File', uri: 'test.ts' })

      const thread = store.getCurrentThread()
      expect(thread?.contextItems).toHaveLength(1)
      expect(thread?.contextItems[0].type).toBe('File')
    })

    it('should not add duplicate context item', () => {
      const store = useAgentStore.getState()
      store.createThread()

      store.addContextItem({ type: 'File', uri: 'test.ts' })
      store.addContextItem({ type: 'File', uri: 'test.ts' })

      const thread = store.getCurrentThread()
      expect(thread?.contextItems).toHaveLength(1)
    })

    it('should remove context item', () => {
      const store = useAgentStore.getState()
      store.createThread()

      store.addContextItem({ type: 'File', uri: 'test.ts' })
      store.removeContextItem(0)

      const thread = store.getCurrentThread()
      expect(thread?.contextItems).toHaveLength(0)
    })

    it('should clear context items', () => {
      const store = useAgentStore.getState()
      store.createThread()

      store.addContextItem({ type: 'File', uri: 'test1.ts' })
      store.addContextItem({ type: 'File', uri: 'test2.ts' })
      store.clearContextItems()

      const thread = store.getCurrentThread()
      expect(thread?.contextItems).toHaveLength(0)
    })
  })
})
