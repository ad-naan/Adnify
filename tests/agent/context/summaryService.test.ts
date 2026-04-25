import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '@store'
import { generateHandoffDocument } from '@renderer/agent/domains/context/summaryService'
import type { ChatMessage, TodoItem } from '@renderer/agent/types'

describe('summaryService handoff', () => {
  beforeEach(() => {
    useStore.setState({
      llmConfig: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: '',
        baseUrl: '',
        timeout: 30000,
      },
    } as any)
  })

  it('preserves the latest user request and active todo list in handoff documents', async () => {
    const todos: TodoItem[] = [
      { content: '梳理上下文压缩流程', activeForm: '正在梳理上下文压缩流程', status: 'in_progress' },
      { content: '让压缩结果在消息流中可见', activeForm: '正在让压缩结果在消息流中可见', status: 'pending' },
    ]

    const messages: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: '先修一下四级压缩丢任务列表的问题',
        timestamp: 1,
      },
      {
        id: 'a1',
        role: 'assistant',
        content: '我先梳理当前逻辑。',
        timestamp: 2,
        parts: [],
      },
      {
        id: 'u2',
        role: 'user',
        content: '新起线程时还要把最新消息一起带过去，并且在聊天面板显示压缩内容',
        timestamp: 3,
      },
    ]

    const result = await generateHandoffDocument('thread-1', messages, 'E:\\Project\\adnify', todos)
    const { handoff } = result

    expect(handoff.lastUserRequest).toBe('新起线程时还要把最新消息一起带过去，并且在聊天面板显示压缩内容')
    expect(handoff.summary.todos).toEqual(todos)
    expect(handoff.summary.pendingSteps).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Continue: 新起线程时还要把最新消息一起带过去'),
        'Task: 梳理上下文压缩流程',
        'Task: 让压缩结果在消息流中可见',
      ])
    )
  })
})
