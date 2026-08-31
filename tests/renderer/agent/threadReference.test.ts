import { describe, expect, it } from 'vitest'
import {
  createThreadDeepLink,
  createThreadLinkMarkdown,
  formatStructuredThreadReference,
  parseThreadDeepLink,
} from '@/renderer/agent/threads/threadReference'

describe('threadReference', () => {
  it('round-trips thread ids through the internal deep link', () => {
    const link = createThreadDeepLink('thread/with spaces')

    expect(link).toBe('adnify://agent/thread/thread%2Fwith%20spaces')
    expect(parseThreadDeepLink(link)).toBe('thread/with spaces')
    expect(parseThreadDeepLink('https://example.com/thread')).toBeNull()
  })

  it('creates a paste-ready markdown link', () => {
    expect(createThreadLinkMarkdown('thread-1', '修复任务')).toBe(
      '[会话：修复任务](adnify://agent/thread/thread-1)',
    )
  })

  it('formats a bounded structured context reference', () => {
    const reference = formatStructuredThreadReference('thread-1', '修复任务', {
      objective: '修复登录问题',
      completedSteps: ['定位问题'],
      pendingSteps: ['补充测试'],
      todos: [],
      decisions: [{
        turnIndex: 1,
        type: 'file_modify',
        description: '沿用现有鉴权流程',
        files: ['src/auth.ts'],
        messageIndex: 2,
      }],
      fileChanges: [{
        path: 'src/auth.ts',
        action: 'modify',
        summary: '修复登录',
        turnIndex: 1,
      }],
      errorsAndFixes: [],
      userInstructions: ['不要修改接口'],
      generatedAt: 1,
      turnRange: [0, 2],
    })

    expect(reference).toContain('[会话：修复任务](adnify://agent/thread/thread-1)')
    expect(reference).toContain('### 目标\n修复登录问题')
    expect(reference).toContain('- 沿用现有鉴权流程')
    expect(reference).toContain('- modify: src/auth.ts')
  })
})
