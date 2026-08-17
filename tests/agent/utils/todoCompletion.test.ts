import { describe, expect, it } from 'vitest'
import { completeTodosAfterSuccessfulTurn } from '@/renderer/agent/utils/todoCompletion'

describe('completeTodosAfterSuccessfulTurn', () => {
  it('marks pending and active tasks completed when the turn finishes', () => {
    const result = completeTodosAfterSuccessfulTurn([
      { content: 'one', activeForm: 'doing one', status: 'completed' },
      { content: 'two', activeForm: 'doing two', status: 'in_progress' },
      { content: 'three', activeForm: 'doing three', status: 'pending' },
    ])

    expect(result.map(todo => todo.status)).toEqual(['completed', 'completed', 'completed'])
  })
})
