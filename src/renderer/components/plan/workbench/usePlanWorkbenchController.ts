import { useCallback, useMemo, useState } from 'react'
import { useStore } from '@/renderer/store'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { projectPlanWorkbench } from '@/renderer/agent/plan/planWorkbenchProjection'
import { Agent } from '@/renderer/agent/core/Agent'
import { toast } from '@/renderer/components/common/ToastProvider'
import { projectPlanHistory, type PlanHistoryEntry } from '@/renderer/agent/plan/planHistoryProjection'
import { beginPlanRevision } from '@/renderer/agent/plan/planRevisionService'
import { buildInteractiveResponse } from '@/renderer/agent/utils/interactiveResponse'

export function usePlanWorkbenchController() {
  const language = useStore(state => state.language)
  const plan = useAgentStore(state => state.plans.find(item => item.id === state.activePlanId))
  const plans = useAgentStore(state => state.plans)
  const currentThreadId = useAgentStore(state => state.currentThreadId)
  const threads = useAgentStore(state => state.threads)
  const switchThread = useAgentStore(state => state.switchThread)
  const setActivePlan = useAgentStore(state => state.setActivePlan)
  const createThread = useAgentStore(state => state.createThread)
  const deletePlan = useAgentStore(state => state.deletePlan)
  const deleteThread = useAgentStore(state => state.deleteThread)
  const updatePlan = useAgentStore(state => state.updatePlan)
  const [starting, setStarting] = useState(false)

  const model = useMemo(() => projectPlanWorkbench({ plan, currentThreadId, threads }), [currentThreadId, plan, threads])
  const history = useMemo(() => projectPlanHistory(plans, threads), [plans, threads])

  const startPlan = useCallback(async () => {
    if (!plan || starting) return
    setStarting(true)
    try {
      const { startPlanExecution } = await import('@/renderer/agent/plan/planExecutor')
      const result = await startPlanExecution(plan.id)
      if (!result.success) toast.error(language === 'zh' ? '启动执行失败' : 'Failed to start', result.message)
    } finally {
      setStarting(false)
    }
  }, [language, plan, starting])

  const submitClarification = useCallback((selectedIds: string[], customText?: string) => {
    if (!model.clarification) return
    const response = buildInteractiveResponse(model.clarification.content, { selectedIds, customText })
    window.dispatchEvent(new CustomEvent('chat-update-interactive', { detail: { messageId: model.clarification.messageId, selectedIds, customText } }))
    window.dispatchEvent(new CustomEvent('chat-send-message', { detail: { content: response, messageId: model.clarification.messageId } }))
  }, [model.clarification])

  const openHistoryEntry = useCallback((entry: PlanHistoryEntry) => {
    if (entry.planId) setActivePlan(entry.planId)
    if (entry.threadId) switchThread(entry.threadId)
  }, [setActivePlan, switchThread])

  /**
   * History mixes two entity types with different lifecycles, so deletion has to
   * branch: a plan owns its JSON, its requirements doc and every plan-task thread
   * it spawned (handled by `deletePlan`), while a bare requirements conversation
   * is just a thread.
   *
   * For a plan entry the linked thread IS the plan's origin conversation (see
   * `projectPlanHistory`, which sets `threadId: plan.originThreadId`), so it is
   * removed together with the plan — leaving it behind would resurface as a
   * separate "conversation" entry for a plan that no longer exists.
   */
  const deleteHistoryEntry = useCallback((entry: PlanHistoryEntry) => {
    if (entry.planId) deletePlan(entry.planId)
    if (entry.threadId) deleteThread(entry.threadId)
  }, [deletePlan, deleteThread])

  const createNewPlan = useCallback(() => {
    setActivePlan(null)
    createThread({ activate: true, mode: 'plan', origin: 'user' })
  }, [createThread, setActivePlan])

  const acceptValidation = useCallback(() => {
    if (!plan) return
    updatePlan(plan.id, { validation: { status: 'accepted', reviewedAt: Date.now() } })
  }, [plan, updatePlan])

  const requestValidationChanges = useCallback(() => {
    if (!plan) return
    const result = beginPlanRevision(plan.id, 'validation', language)
    if (result.success) toast.info(result.message)
    else toast.error(language === 'zh' ? '无法继续调整' : 'Unable to revise', result.message)
  }, [language, plan])

  const revisePlan = useCallback(() => {
    if (!plan) return
    const result = beginPlanRevision(plan.id, 'review', language)
    if (result.success) toast.info(result.message)
    else toast.error(language === 'zh' ? '无法调整计划' : 'Unable to revise plan', result.message)
  }, [language, plan])

  const approve = useCallback((requestId?: string) => {
    if (!requestId) {
      toast.error(language === 'zh' ? '审批请求已失效' : 'Approval request expired')
      return
    }
    Agent.approve(requestId)
  }, [language])

  const reject = useCallback((requestId?: string) => {
    if (!requestId) {
      toast.error(language === 'zh' ? '审批请求已失效' : 'Approval request expired')
      return
    }
    Agent.reject(requestId)
  }, [language])

  return {
    language,
    plan,
    model,
    history,
    starting,
    startPlan,
    submitClarification,
    approve,
    reject,
    openThread: switchThread,
    openHistoryEntry,
    deleteHistoryEntry,
    createNewPlan,
    acceptValidation,
    requestValidationChanges,
    revisePlan,
  }
}
