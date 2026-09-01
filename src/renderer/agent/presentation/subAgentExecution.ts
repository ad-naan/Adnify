import { t, type Language } from '@shared/i18n'

export type SubAgentStepState = 'pending' | 'active' | 'waiting' | 'complete' | 'error'

export interface SubAgentExecutionStep {
  id: 'brief' | 'work' | 'report'
  label: string
  detail: string
  state: SubAgentStepState
}

export interface SubAgentExecutionInput {
  language: Language
  hasThread: boolean
  isRunning: boolean
  isSuccess: boolean
  isError: boolean
  waitingApproval: boolean
  currentToolName?: string
  completedToolCount: number
}

/** Maps real child-thread state to a small, stable execution story for the UI. */
export function buildSubAgentExecutionSteps(input: SubAgentExecutionInput): SubAgentExecutionStep[] {
  const language = input.language
  const workDetail = input.waitingApproval
    ? t('subAgentExecution.waitingForApproval', language)
    : input.currentToolName
      ? t('subAgentExecution.usingTool', language, { tool: input.currentToolName })
      : input.completedToolCount > 0
        ? t('subAgentExecution.completedToolCalls', language, { count: input.completedToolCount })
        : input.isRunning
          ? t('subAgentExecution.analyzingAndExecuting', language)
          : input.isSuccess
            ? t('subAgentExecution.executionFinished', language)
            : t('subAgentExecution.notStarted', language)

  return [
    {
      id: 'brief',
      label: t('subAgentExecution.receiveBrief', language),
      detail: input.hasThread || input.isError
        ? t('subAgentExecution.contextHandedToSubAgent', language)
        : t('subAgentExecution.startingSubAgent', language),
      state: input.hasThread || input.isError ? 'complete' : 'active',
    },
    {
      id: 'work',
      label: t('subAgentExecution.executeTask', language),
      detail: workDetail,
      state: input.isError
        ? 'error'
        : input.isSuccess
          ? 'complete'
          : input.waitingApproval
            ? 'waiting'
            : input.hasThread && input.isRunning
              ? 'active'
              : 'pending',
    },
    {
      id: 'report',
      label: t('subAgentExecution.reportBack', language),
      detail: input.isSuccess
        ? t('subAgentExecution.resultReturnedToParent', language)
        : input.isError
          ? t('subAgentExecution.failureReturnedToParent', language)
          : t('subAgentExecution.waitingForExecution', language),
      state: input.isSuccess ? 'complete' : input.isError ? 'error' : 'pending',
    },
  ]
}
