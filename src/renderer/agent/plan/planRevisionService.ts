import { useAgentStore } from '@/renderer/agent/store/AgentStore'

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
      message: language === 'zh' ? '计划不存在或已被删除' : 'The plan no longer exists',
    }
  }
  if (isRunningStatus(plan.status)) {
    return {
      success: false,
      message: language === 'zh' ? '请先暂停或停止当前计划，再进行调整' : 'Pause or stop the running plan before revising it',
    }
  }
  if (!plan.originThreadId || !store.threads[plan.originThreadId]) {
    return {
      success: false,
      message: language === 'zh' ? '找不到该计划的规划对话，无法进入调整状态' : 'The planning conversation for this plan is unavailable',
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
    ? (language === 'zh'
        ? `请继续调整计划「${plan.name}」的执行结果：`
        : `Please revise the execution result of plan "${plan.name}": `)
    : (language === 'zh'
        ? `请调整计划「${plan.name}」：`
        : `Please revise plan "${plan.name}": `)
  store.setInputPrompt(prompt)

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('chat-focus-input'))
  }

  return {
    success: true,
    message: language === 'zh' ? '已进入计划调整，请描述需要修改的内容' : 'Revision mode is ready; describe the changes you need',
  }
}

