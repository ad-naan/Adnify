import { create } from 'zustand'
import type { PlanWorkbenchStage } from './planWorkbenchProjection'

interface PlanViewState {
  selectedStageByPlanId: Record<string, PlanWorkbenchStage>
  revealedPlanIds: Record<string, boolean>
  sidebarView: 'discussion' | 'details'
  historyOpen: boolean
  setHistoryOpen: (open: boolean) => void
  discussionTarget: { planId: string; taskId: string; title: string; threadId: string } | null
  revealPlan: (planId: string) => void
  setSidebarView: (view: 'discussion' | 'details') => void
  setDiscussionTarget: (target: PlanViewState['discussionTarget']) => void
  selectStage: (planId: string, stage: PlanWorkbenchStage) => void
  clearPlanView: (planId: string) => void
}

/** Shared UI navigation state for the center board and the Plan side panel. */
export const usePlanViewStore = create<PlanViewState>()(set => ({
  selectedStageByPlanId: {},
  revealedPlanIds: {},
  sidebarView: 'discussion',
  historyOpen: false,
  setHistoryOpen: historyOpen => set({ historyOpen }),
  discussionTarget: null,
  revealPlan: planId => set(state => ({ revealedPlanIds: { ...state.revealedPlanIds, [planId]: true } })),
  setSidebarView: sidebarView => set({ sidebarView }),
  setDiscussionTarget: discussionTarget => set({ discussionTarget, sidebarView: 'discussion' }),
  selectStage: (planId, stage) => set(state => ({
    selectedStageByPlanId: { ...state.selectedStageByPlanId, [planId]: stage },
  })),
  clearPlanView: planId => set(state => {
    const next = { ...state.selectedStageByPlanId }
    delete next[planId]
    const revealed = { ...state.revealedPlanIds }
    delete revealed[planId]
    return { selectedStageByPlanId: next, revealedPlanIds: revealed, discussionTarget: state.discussionTarget?.planId === planId ? null : state.discussionTarget }
  }),
}))
