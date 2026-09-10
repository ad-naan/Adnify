import { isPlanBoardPath } from '@/shared/types/planBoard'

interface PlanPresentationInput {
  mode: string
  activeFilePath: string | null
  editorVisible: boolean
  chatVisible: boolean
  activeSidePanel: string | null
  focusedPanel: string | null
  threadOrigin?: string
  threadMode?: string
  plan?: { id: string; status: string; originThreadId?: string } | null
  currentThreadId: string | null
  revealed: boolean
  debugVisible?: boolean
  editorTerminalVisible?: boolean
}

/** Transient presentation only: never rewrite the user's saved docking layout. */
export function shouldUsePlanCanvas(input: PlanPresentationInput): boolean {
  if (input.mode !== 'plan' || !input.editorVisible || !input.chatVisible
    || !isPlanBoardPath(input.activeFilePath || '') || input.activeSidePanel === 'shell'
    || input.debugVisible || input.editorTerminalVisible
    || (input.focusedPanel !== null && input.focusedPanel !== 'agent')
    || input.threadOrigin === 'plan-task' || (input.threadMode && input.threadMode !== 'plan')) return false
  if (!input.plan) return true
  if (input.plan.originThreadId && input.plan.originThreadId !== input.currentThreadId) return false
  return input.plan.status === 'draft' && !input.revealed
}
