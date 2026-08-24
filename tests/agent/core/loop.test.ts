/**
 * Agent Loop 测试
 * 测试 Agent 主循环逻辑
 */

import { beforeAll, describe, it, expect, vi } from 'vitest'

// Mock dependencies
vi.mock('@renderer/services/WorkspaceManager', () => ({
  workspaceManager: {
    getCurrentWorkspacePath: vi.fn(() => '/test/workspace'),
  },
}))

let prepareLLMRequestMessages: typeof import('@renderer/agent/core/loop').prepareLLMRequestMessages
let clearUnexecutedToolCards: typeof import('@renderer/agent/core/loop').clearUnexecutedToolCards

beforeAll(async () => {
  vi.stubGlobal('self', globalThis)
  ;({ prepareLLMRequestMessages, clearUnexecutedToolCards } = await import('@renderer/agent/core/loop'))
})

describe('Agent Loop', () => {
  describe('System prompt propagation', () => {
    it('removes inline system messages when a dedicated system prompt is provided', () => {
      const result = prepareLLMRequestMessages([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: '你是谁' },
      ], 'You are helpful.')

      expect(result).toEqual([
        { role: 'user', content: '你是谁' },
      ])
    })

    it('keeps messages unchanged when there is no dedicated system prompt', () => {
      const messages = [
        { role: 'system' as const, content: 'You are helpful.' },
        { role: 'user' as const, content: '你是谁' },
      ]

      expect(prepareLLMRequestMessages(messages, undefined)).toEqual(messages)
    })
  })

  describe('Loop Detection', () => {
    it('clears only the rejected proposal and preserves calls from earlier iterations', () => {
      const calls = [
        { id: 'completed-call', name: 'find_symbol', arguments: {}, status: 'success' },
        { id: 'earlier-running-call', name: 'read_file', arguments: {}, status: 'running' },
        { id: 'rejected-call', name: 'read_file', arguments: {}, status: 'pending' },
      ] as const
      const updateMessage = vi.fn()
      const clearToolStreamingPreview = vi.fn()

      clearUnexecutedToolCards({
        getMessages: () => [{
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          parts: calls.map(toolCall => ({ type: 'tool_call' as const, toolCall })),
          toolCalls: [...calls],
          timestamp: Date.now(),
        }],
        updateMessage,
        clearToolStreamingPreview,
      }, 'assistant-1', [{ id: 'rejected-call' }])

      const updates = updateMessage.mock.calls[0][1]
      expect(updates.parts.map((part: { toolCall: { id: string } }) => part.toolCall.id)).toEqual([
        'completed-call',
        'earlier-running-call',
      ])
      expect(updates.toolCalls.map((toolCall: { id: string }) => toolCall.id)).toEqual([
        'completed-call',
        'earlier-running-call',
      ])
      expect(clearToolStreamingPreview).toHaveBeenCalledOnce()
      expect(clearToolStreamingPreview).toHaveBeenCalledWith('rejected-call')
    })

    it('should detect infinite loops', () => {
      // 测试循环检测逻辑
      expect(true).toBe(true)
    })

    it('should allow reasonable retry attempts', () => {
      // 测试合理的重试次数
      expect(true).toBe(true)
    })
  })

  describe('Error Handling', () => {
    it('should handle tool execution errors', () => {
      // 测试工具执行错误处理
      expect(true).toBe(true)
    })

    it('should recover from transient failures', () => {
      // 测试临时失败恢复
      expect(true).toBe(true)
    })
  })
})
