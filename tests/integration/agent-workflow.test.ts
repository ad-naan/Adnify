/**
 * Agent 工作流集成测试
 * 测试完整的 Agent 执行流程
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAgentStore } from '@renderer/agent/store/AgentStore'
// import { mockElectronAPI } from '../setup'

describe('Agent Workflow Integration', () => {
  beforeEach(() => {
    // 重置 store
    useAgentStore.setState({
      threads: {},
      currentThreadId: null,
    })
    vi.clearAllMocks()
  })

  it('should complete a full conversation flow', async () => {
    const store = useAgentStore.getState()

    // 1. 创建线程
    const threadId = store.createThread()
    expect(threadId).toBeDefined()

    // 2. 添加用户消息
    const userMsgId = store.addUserMessage('Read file test.ts')
    expect(userMsgId).toBeDefined()

    // 3. 添加助手消息
    const assistantMsgId = store.addAssistantMessage()
    expect(assistantMsgId).toBeDefined()

    // 4. 添加工具调用
    store.addToolCallPart(assistantMsgId, {
      id: 'tc1',
      name: 'read_file',
      arguments: { path: 'test.ts' },
    })

    // 5. 更新工具调用状态
    store.updateToolCall(assistantMsgId, 'tc1', {
      status: 'running',
    })

    // 6. 完成工具调用
    store.updateToolCall(assistantMsgId, 'tc1', {
      status: 'success',
      result: 'const x = 1;',
    })

    // 7. 添加工具结果消息
    store.addToolResult('tc1', 'read_file', 'const x = 1;', 'success')

    // 8. 完成助手消息
    store.finalizeAssistant(assistantMsgId)

    // 验证最终状态
    const messages = store.getMessages()
    expect(messages).toHaveLength(3) // user + assistant + tool
    expect(messages[0].role).toBe('user')
    expect(messages[1].role).toBe('assistant')
    expect(messages[2].role).toBe('tool')
  })

  it('should handle tool execution errors', async () => {
    const store = useAgentStore.getState()

    store.createThread()
    const assistantMsgId = store.addAssistantMessage()

    store.addToolCallPart(assistantMsgId, {
      id: 'tc1',
      name: 'read_file',
      arguments: { path: 'nonexistent.ts' },
    })

    store.updateToolCall(assistantMsgId, 'tc1', {
      status: 'error',
      error: 'File not found',
    })

    const messages = store.getMessages()
    const assistant = messages[0] as any
    expect(assistant.toolCalls[0].status).toBe('error')
    expect(assistant.toolCalls[0].error).toBe('File not found')
  })

  it('should manage context items during conversation', async () => {
    const store = useAgentStore.getState()

    store.createThread()

    // 添加文件上下文
    store.addContextItem({ type: 'File', uri: 'test.ts' })
    store.addContextItem({ type: 'File', uri: 'main.ts' })

    // 添加代码库搜索上下文
    store.addContextItem({ type: 'Codebase' })

    let thread = useAgentStore.getState().getCurrentThread()
    expect(thread?.contextItems).toHaveLength(3)

    // 移除一个上下文
    store.removeContextItem(1)
    thread = useAgentStore.getState().getCurrentThread()
    expect(thread?.contextItems).toHaveLength(2)

    // 清空上下文
    store.clearContextItems()
    thread = useAgentStore.getState().getCurrentThread()
    expect(thread?.contextItems).toHaveLength(0)
  })
})
