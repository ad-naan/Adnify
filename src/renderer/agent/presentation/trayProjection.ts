import type { PendingChange, ToolCall } from '../types'
import type { DockFrame } from './turnTimeline'

/** No timers or local progress: action visibility is a pure timeline projection. */
export function projectTrayActions(frame: DockFrame | undefined, tools: ToolCall[], changes: PendingChange[]) {
  const belongsToTurn = (id: string) => frame?.sourceToolIds.includes(id)
  return {
    tools: tools.filter(tool => !belongsToTurn(tool.id) || frame?.toolStates[tool.id] === 'awaiting'),
    changes: changes.filter(change => !belongsToTurn(change.toolCallId) || frame?.toolStates[change.toolCallId] === 'success'),
  }
}
