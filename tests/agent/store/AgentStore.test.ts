/**
 * AgentStore 测试
 * 测试状态管理和消息操作
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useAgentStore } from '@renderer/agent/store/AgentStore'
import type { HandoffDocument } from '@renderer/agent/domains/context/types'

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

  describe('Handoff Sessions', () => {
    it('should restore objective, pending steps, and todos into the new thread', () => {
      const store = useAgentStore.getState()
      store.createThread()

      const handoff: HandoffDocument = {
        fromSessionId: 'thread-old',
        createdAt: Date.now(),
        workingDirectory: 'E:\\Project\\adnify',
        keyFileSnapshots: [],
        lastUserRequest: '继续把压缩内容显示在消息流里',
        suggestedNextSteps: ['显示压缩卡片'],
        summary: {
          objective: '修复上下文续接',
          completedSteps: ['补齐 handoff 摘要'],
          pendingSteps: ['显示压缩卡片', '恢复任务列表'],
          todos: [
            { content: '显示压缩卡片', activeForm: '正在显示压缩卡片', status: 'in_progress' },
            { content: '恢复任务列表', activeForm: '正在恢复任务列表', status: 'pending' },
          ],
          decisions: [],
          fileChanges: [],
          errorsAndFixes: [],
          userInstructions: [],
          generatedAt: Date.now(),
          turnRange: [0, 4],
        },
      }

      store.setHandoffState({
        status: 'ready',
        document: handoff,
        createdAt: handoff.createdAt,
      })
      const session = store.createHandoffSession()

      expect(session).toBeTruthy()
      expect(session?.objective).toBe('修复上下文续接')

      const newThread = useAgentStore.getState().threads[session!.threadId]
      expect(newThread.pendingObjective).toBe('修复上下文续接')
      expect(newThread.pendingSteps).toEqual(['显示压缩卡片', '恢复任务列表'])
      expect(newThread.todos).toEqual(handoff.summary.todos)
      expect(newThread.handoffContext).toContain('## Session Resume Context')
      const sourceThread = useAgentStore.getState().threads[newThread.handoffResume!.sourceThreadId]
      const sourceMarker = sourceThread.messages.at(-1)
      expect(sourceMarker?.role).toBe('assistant')
      if (sourceMarker?.role === 'assistant') {
        expect(sourceMarker.parts[0]).toMatchObject({
          type: 'context_snapshot',
          snapshotKind: 'handoff',
          presentation: 'source_marker',
        })
      }

      const resumeCard = newThread.messages[0]
      expect(resumeCard?.role).toBe('assistant')
      if (resumeCard?.role === 'assistant') {
        expect(resumeCard.parts[0]).toMatchObject({
          type: 'context_snapshot',
          snapshotKind: 'handoff',
          presentation: 'resume_card',
        })
      }
      expect(newThread.handoffContext).toContain('继续把压缩内容显示在消息流里')
    })
    it('should clear thread handoff state when deleting later messages', () => {
      const store = useAgentStore.getState()
      store.createThread()

      const userMessageId = store.addUserMessage('keep this')
      store.addAssistantMessage('reply')
      store.setCompressionStats({
        level: 4,
        levelName: 'Session Handoff',
        ratio: 1.1,
        inputTokens: 1000,
        outputTokens: 100,
        contextLimit: 1000,
        savedTokens: 0,
        savedPercent: 0,
        messageCount: 2,
        needsHandoff: true,
        lastUpdatedAt: Date.now(),
      })
      store.setHandoffState({
        status: 'ready',
        document: {
          fromSessionId: 'thread-old',
          createdAt: Date.now(),
          workingDirectory: 'E:\\Project\\adnify',
          keyFileSnapshots: [],
          lastUserRequest: 'continue',
          suggestedNextSteps: ['resume work'],
          summary: {
            objective: 'resume work',
            completedSteps: [],
            pendingSteps: ['resume work'],
            todos: [],
            decisions: [],
            fileChanges: [],
            errorsAndFixes: [],
            userInstructions: [],
            generatedAt: Date.now(),
            turnRange: [0, 2],
          },
        },
      })

      store.deleteMessagesAfter(userMessageId)

      const thread = useAgentStore.getState().getCurrentThread()
      expect(thread?.handoff.status).toBe('idle')
      expect(thread?.handoff.document).toBeNull()
      expect(thread?.compressionStats).toBeNull()
    })
  })
})
