import { describe, expect, it } from 'vitest'
import { summarizeAgentEvent } from '@renderer/notifications/agentEvents'
import type { LoopEndReason } from '@renderer/agent/core/EventBus'

describe('agent notification summaries', () => {
  it.each<[LoopEndReason, boolean, string]>([
    ['complete', true, 'agent.loop.completed'],
    ['tool_requested_stop', true, 'agent.loop.completed'],
    ['error', true, 'agent.loop.failed'],
    ['waiting_for_user', true, 'agent.loop.waiting'],
    ['handoff_required', true, 'agent.loop.waiting'],
    ['aborted', false, 'agent.loop.end'],
    ['user_rejected', false, 'agent.loop.end'],
    ['no_messages', false, 'agent.loop.end'],
  ])('maps %s without falsely announcing completion', (reason, attention, type) => {
    expect(summarizeAgentEvent({ type: 'loop:end', reason, threadId: 'thread', requestId: 'run' }, 'zh')).toMatchObject(
      { type, attention, threadId: 'thread', correlationId: 'run' },
    )
  })
  it('keeps streaming content and tool errors out of push summaries', () => {
    expect(JSON.stringify(summarizeAgentEvent({ type: 'stream:text', text: 'PRIVATE CODE' }, 'en'))).not.toContain(
      'PRIVATE CODE',
    )
    expect(
      JSON.stringify(
        summarizeAgentEvent({ type: 'tool:error', id: 'tool', error: 'https://server?token=SECRET' }, 'en'),
      ),
    ).not.toContain('SECRET')
    expect(
      summarizeAgentEvent({ type: 'tool:pending', id: 'tool', name: 'autoapproved', args: {} }, 'en').attention,
    ).toBe(false)
  })
})
