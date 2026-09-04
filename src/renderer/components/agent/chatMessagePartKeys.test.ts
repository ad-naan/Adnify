import { describe, expect, it } from 'vitest'
import type { AssistantPart } from '@/renderer/agent/types'
import { buildChatMessagePartKeys } from './chatMessagePartKeys'

describe('buildChatMessagePartKeys', () => {
  it('uses intrinsic ids and append-stable positional fallbacks', () => {
    const parts: AssistantPart[] = [
      { type: 'text', content: 'first' },
      { id: 'reasoning-1', type: 'reasoning', content: 'thinking' },
      { type: 'text', content: 'second' },
      { type: 'sources', sources: [] },
      { type: 'text', content: 'third' },
    ]

    expect(buildChatMessagePartKeys(parts)).toEqual([
      'text:index-0',
      'reasoning:reasoning-1',
      'text:index-2',
      'sources:index-3',
      'text:index-4',
    ])
  })

  it('does not change earlier keys when another text segment arrives', () => {
    const parts: AssistantPart[] = [{ type: 'text', content: 'intro' }]
    const before = buildChatMessagePartKeys(parts)
    expect(buildChatMessagePartKeys([...parts, { type: 'text', content: 'answer' }]).slice(0, 1)).toEqual(before)
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
