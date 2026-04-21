import { describe, expect, it } from 'vitest'
import { MessageAssembler } from '@renderer/agent/domains/message/MessageAssembler'
import type { ChatMessage } from '@renderer/agent/types'

describe('MessageAssembler', () => {
  it('injects resume state as a separate runtime assistant message', () => {
    const assembler = new MessageAssembler()
    const history: ChatMessage[] = []

    const result = assembler.assemble(
      history,
      assembler.assembleUserMessage('继续处理上下文压缩', ''),
      'stable system prompt',
      0,
      {
        handoffContext: '## Session Resume Context\nCarry over previous work.',
        pendingObjective: '修复上下文续接',
        pendingSteps: ['补齐最新消息', '补齐任务列表'],
        todos: [
          { content: '补齐最新消息', activeForm: '正在补齐最新消息', status: 'in_progress' },
        ],
      }
    )

    expect(result.messages[0]).toMatchObject({
      role: 'system',
      content: 'stable system prompt',
    })
    expect(result.messages[1]).toMatchObject({
      role: 'assistant',
    })
    expect(String(result.messages[1].content)).toContain('Application runtime state snapshot.')
    expect(String(result.messages[1].content)).toContain('## Session Resume Context')
    expect(String(result.messages[1].content)).toContain('## Runtime Task List')
    expect(result.messages[2]).toMatchObject({
      role: 'user',
      content: '继续处理上下文压缩',
    })
  })
})
