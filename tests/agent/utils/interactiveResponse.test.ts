import { describe, expect, it } from 'vitest'
import { buildInteractiveResponse, findThreadIdForMessage } from '@/renderer/agent/utils/interactiveResponse'
import { createEmptyThread } from '@/renderer/agent/store/slices/threadSlice'

describe('interactiveResponse', () => {
  const content = {
    type: 'interactive' as const,
    question: 'Choose',
    options: [
      { id: 'one', label: 'First' },
      { id: 'two', label: 'Second' },
    ],
  }

  it('uses a trimmed free-form response instead of preset labels', () => {
    expect(buildInteractiveResponse(content, {
      selectedIds: ['one'],
      customText: '  a more precise answer  ',
    })).toBe('a more precise answer')
  })

  it('joins preset labels when no free-form response was supplied', () => {
    expect(buildInteractiveResponse(content, { selectedIds: ['one', 'two'] }))
      .toBe('First, Second')
  })

  it('finds the thread that owns an interactive message', () => {
    const first = createEmptyThread({ mode: 'agent', origin: 'user' })
    const second = createEmptyThread({ mode: 'plan', origin: 'user' })
    second.messages = [{ id: 'question-message', role: 'assistant', content: '', timestamp: 1, parts: [] }]

    expect(findThreadIdForMessage({ [first.id]: first, [second.id]: second }, 'question-message'))
      .toBe(second.id)
  })
})
