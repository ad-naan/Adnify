import type { TodoItem } from '../types'

/** A normally completed agent turn must not leave its visible task list running. */
export function completeTodosAfterSuccessfulTurn(todos: readonly TodoItem[]): TodoItem[] {
  return todos.map(todo => todo.status === 'completed'
    ? todo
    : { ...todo, status: 'completed' as const })
}
