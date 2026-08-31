import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { t, asLanguage } from '@renderer/i18n'

export type PlanRevisionSource = 'review' | 'validation'

export interface BeginPlanRevisionResult {
  success: boolean
  message: string
}

const isRunningStatus = (status: string) => ['executing', 'pausing', 'paused', 'stopping'].includes(status)

/**
 * Moves an existing plan back into an editable planning conversation.
 *
 * This intentionally does not send a model request. It restores the plan's
 * origin thread, prepares a revision prompt and focuses the composer so the
 * user can describe the change before any tool is called.
 */
export function beginPlanRevision(
  planId: string,
  source: PlanRevisionSource,
  language: string,
): BeginPlanRevisionResult {
  const store = useAgentStore.getState()
  const plan = store.getPlan(planId)

  if (!plan) {
    return {
      success: false,
      message: t('planRevisionService.thePlanNoLonger', asLanguage(language)),
    }
  }
  if (isRunningStatus(plan.status)) {
    return {
      success: false,
      message: t('planRevisionService.pauseOrStopThe', asLanguage(language)),
    }
  }
  if (!plan.originThreadId || !store.threads[plan.originThreadId]) {
    return {
      success: false,
      message: t('planRevisionService.thePlanningConversationFor', asLanguage(language)),
    }
  }

  store.updatePlan(plan.id, {
    status: 'draft',
    validation: source === 'validation'
      ? { status: 'changes_requested', reviewedAt: Date.now() }
      : undefined,
  })
  store.setActivePlan(plan.id)
  store.switchThread(plan.originThreadId)

  const prompt = source === 'validation'
    ? (t('planRevisionService.pleaseReviseTheExecution', asLanguage(language), { name: plan.name }))
    : (t('planRevisionService.pleaseRevisePlan', asLanguage(language), { name: plan.name }))
  store.setInputPrompt(prompt)

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('chat-focus-input'))
  }

  return {
    success: true,
    message: t('planRevisionService.revisionModeIsReady', asLanguage(language)),
  }
}

