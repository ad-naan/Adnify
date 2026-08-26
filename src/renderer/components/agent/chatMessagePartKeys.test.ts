import { describe, expect, it } from 'vitest'
import type { AssistantPart } from '@/renderer/agent/types'
import { buildChatMessagePartKeys } from './chatMessagePartKeys'

describe('buildChatMessagePartKeys', () => {
  it('uses intrinsic ids and deterministic from-end fallbacks', () => {
    const parts: AssistantPart[] = [
      { type: 'text', content: 'first' },
      { id: 'reasoning-1', type: 'reasoning', content: 'thinking' },
      { type: 'text', content: 'second' },
      { type: 'sources', sources: [] },
      { type: 'text', content: 'third' },
    ]

    expect(buildChatMessagePartKeys(parts)).toEqual([
      'text:from-end-2',
      'reasoning:reasoning-1',
      'text:from-end-1',
      'sources:from-end-0',
      'text:from-end-0',
    ])
  })

  it('uses tool call ids even when the provider omits part ids', () => {
    const parts: AssistantPart[] = [{
      type: 'tool_call',
      toolCall: {
        id: 'tool-1',
        name: 'read_file',
        arguments: {},
        status: 'pending',
      },
    }]

    expect(buildChatMessagePartKeys(parts)).toEqual(['tool:tool-1'])
  })
})
