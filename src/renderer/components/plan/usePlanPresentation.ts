import { useShallow } from 'zustand/react/shallow'
import { useStore, useModeStore } from '@/renderer/store'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { usePlanViewStore } from '@/renderer/agent/plan/planViewStore'
import { shouldUsePlanCanvas } from '@/renderer/agent/plan/planPresentation'

export function usePlanPresentation() {
  const layout = useStore(useShallow(state => ({
    activeFilePath: state.activeFilePath, editorVisible: state.editorVisible,
    chatVisible: state.chatVisible, activeSidePanel: state.activeSidePanel, focusedPanel: state.focusedPanel,
    debugVisible: state.debugVisible,
    editorTerminalVisible: state.terminalVisible && state.workbenchLayout.terminalPosition === 'editor',
  })))
  const mode = useModeStore(state => state.currentMode)
  const plan = useAgentStore(state => state.plans.find(item => item.id === state.activePlanId))
  const currentThreadId = useAgentStore(state => state.currentThreadId)
  const thread = useAgentStore(state => state.currentThreadId ? state.threads[state.currentThreadId] : undefined)
  const revealed = usePlanViewStore(state => Boolean(plan && state.revealedPlanIds[plan.id]))
  const canvas = shouldUsePlanCanvas({ ...layout, mode, plan, currentThreadId, revealed, threadOrigin: thread?.origin, threadMode: thread?.mode })
  return { canvas, plan, empty: !plan && !thread?.messages.some(message => message.role === 'user' || message.role === 'assistant') }
}
