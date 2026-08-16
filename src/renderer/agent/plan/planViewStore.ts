import { create } from 'zustand'
import type { PlanWorkbenchStage } from './planWorkbenchProjection'

interface PlanViewState {
  selectedStageByPlanId: Record<string, PlanWorkbenchStage>
  selectStage: (planId: string, stage: PlanWorkbenchStage) => void
  clearPlanView: (planId: string) => void
}

/** Shared UI navigation state for the center board and the Plan side panel. */
export const usePlanViewStore = create<PlanViewState>()(set => ({
  selectedStageByPlanId: {},
  selectStage: (planId, stage) => set(state => ({
    selectedStageByPlanId: { ...state.selectedStageByPlanId, [planId]: stage },
  })),
  clearPlanView: planId => set(state => {
    const next = { ...state.selectedStageByPlanId }
    delete next[planId]
    return { selectedStageByPlanId: next }
  }),
}))

