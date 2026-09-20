import { describe, expect, it } from 'vitest'
import { prepareMessages } from '@/renderer/agent/domains/context/CompressionManager'
import { buildLLMApiMessages } from '@/renderer/agent/domains/message/MessageConverter'
import type { ChatMessage } from '@/renderer/agent/types'

function userMsg(id: string, text: string): ChatMessage {
  return { id, role: 'user', content: text, timestamp: Number(id.replace(/\D/g, '')) || 1 } as ChatMessage
}

function assistantEdit(id: string, content: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: '',
    timestamp: 1,
    parts: [],
    toolCalls: [
      {
        id: `${id}-tc`,
        name: 'edit_file',
        arguments: { path: 'src/a.ts', new_string: content },
        status: 'success',
      },
    ],
  } as unknown as ChatMessage
}

/** A long history so the message-count limit actually bites. */
function longHistory(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => userMsg(`m${i + 1}`, `message ${i + 1}`))
}

describe('compression message-count truncation', () => {
  it('truncates aggressively at L4 when a continuity artifact exists', () => {
    const result = prepareMessages(longHistory(80), 4, { hasContinuityArtifact: true })
    // L4 limit is 10.
    expect(result.messages.length).toBe(10)
    expect(result.removedMessages).toBe(70)
  })

  it('preserves early constraints when no summary exists', () => {
    // Summary generation is reactive, so a turn can reach L4 with
    // contextSummary === null. Dropping to 10 messages there loses the session.
    const result = prepareMessages(longHistory(80), 4, { hasContinuityArtifact: false })
    expect(result.messages.length).toBe(80)
    expect(result.messages[0]).toMatchObject({ content: 'message 1' })
  })

  it('keeps the most recent messages when truncating', () => {
    const result = prepareMessages(longHistory(80), 4, { hasContinuityArtifact: true })
    const last = result.messages.at(-1) as { content: string }
    expect(last.content).toBe('message 80')
  })

  it('starts retained history at a user request, even after a long tool turn', () => {
    const messages = [
      userMsg('m1', 'Old task'),
      userMsg('m2', 'Keep this requirement'),
      ...Array.from({ length: 12 }, (_, i) => ({
        id: `a${i + 3}`, role: 'assistant', content: `Step ${i}`, timestamp: i + 3, parts: [],
      } as ChatMessage)),
      userMsg('m15', 'Follow up'),
    ]

    const result = prepareMessages(messages, 4, { hasContinuityArtifact: true })
    expect(result.messages[0]).toMatchObject({ role: 'user', content: 'Keep this requirement' })
    expect(result.messages.at(-1)).toMatchObject({ role: 'user', content: 'Follow up' })
  })

  it('defaults to preserving history when the continuity flag is omitted', () => {
    expect(prepareMessages(longHistory(80), 4).messages.length).toBe(80)
  })

  it('preserves history at lower levels until a summary exists', () => {
    const result = prepareMessages(longHistory(80), 1, { hasContinuityArtifact: false })
    expect(result.messages.length).toBe(80)
  })
})

describe('compression tool-argument truncation', () => {
  // Must exceed the L1 threshold (maxToolResultChars, 10000) to be truncated.
  const bigEdit = ['function first() {', '  return 1', '}', ...Array(700).fill('  // filler line for bulk')].join('\n')

  // L1 truncates arguments without invoking pruneMessages (which is L2+ and
  // removes tool-call messages outright), so it isolates the behaviour under test.
  it('preserves line count and an excerpt instead of only a char total', () => {
    const messages = [
      assistantEdit('a1', bigEdit),
      userMsg('m2', 'later turn'),
      { id: 'a3', role: 'assistant', content: 'done', timestamp: 3, parts: [] } as unknown as ChatMessage,
    ]

    const result = prepareMessages(messages, 1, { hasContinuityArtifact: true })
    const edited = result.messages.find(m => m.id === 'a1') as { toolCalls: Array<{ arguments: Record<string, string> }> }
    const value = edited.toolCalls[0].arguments.new_string

    expect(result.truncatedToolCalls).toBeGreaterThan(0)
    // The agent can still tell WHAT it wrote, not just how many bytes.
    expect(value).toContain('lines written')
    expect(value).toContain('function first()')
    expect(value.length).toBeLessThan(bigEdit.length)
  })

  it('never produces a placeholder longer than the value it replaces', () => {
    // Just past the L1 threshold, where a verbose summary could backfire.
    const modest = 'x'.repeat(10_050)
    const messages = [
      assistantEdit('a1', modest),
      userMsg('m2', 'later'),
      { id: 'a3', role: 'assistant', content: 'done', timestamp: 3, parts: [] } as unknown as ChatMessage,
    ]

    const result = prepareMessages(messages, 1, { hasContinuityArtifact: true })
    const edited = result.messages.find(m => m.id === 'a1') as { toolCalls: Array<{ arguments: Record<string, string> }> }
    expect(edited.toolCalls[0].arguments.new_string.length).toBeLessThan(modest.length)
  })

  it('leaves the most recent assistant message untouched', () => {
    const messages = [
      userMsg('m1', 'first'),
      assistantEdit('a2', bigEdit),
    ]

    const result = prepareMessages(messages, 1, { hasContinuityArtifact: true })
    const edited = result.messages.find(m => m.id === 'a2') as { toolCalls: Array<{ arguments: Record<string, string> }> }
    // The pending edit must survive in full so the agent can act on it.
    expect(edited.toolCalls[0].arguments.new_string).toBe(bigEdit)
  })
})

describe('compressed tool results', () => {
  it('keeps a useful excerpt in the actual model request', () => {
    const output = `Important finding: config must stay enabled.\n${'details\n'.repeat(200)}Final error: missing token`
    const messages = [
      userMsg('m1', 'Inspect the configuration'),
      {
        id: 'a2', role: 'assistant', content: '', timestamp: 2, parts: [],
        toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'config.json' }, status: 'success' }],
      },
      { id: 't3', role: 'tool', content: output, name: 'read_file', toolCallId: 'call-1', timestamp: 3 },
      userMsg('m4', 'Keep going'),
      { id: 'a5', role: 'assistant', content: 'Working on it', timestamp: 5, parts: [] },
      userMsg('m6', 'What did you find?'),
    ] as ChatMessage[]

    const prepared = prepareMessages(messages, 3, { hasContinuityArtifact: false })
    const request = buildLLMApiMessages(prepared.messages)
    const tool = request.find(message => message.role === 'tool')

    expect(prepared.clearedToolResults).toBe(1)
    expect(String(tool?.content)).toContain('Important finding: config must stay enabled.')
    expect(String(tool?.content)).toContain('Final error: missing token')
    expect(String(tool?.content).length).toBeLessThan(output.length)
  })
})
