export type SubAgentStepState = 'pending' | 'active' | 'waiting' | 'complete' | 'error'

export interface SubAgentExecutionStep {
  id: 'brief' | 'work' | 'report'
  label: string
  detail: string
  state: SubAgentStepState
}

export interface SubAgentExecutionInput {
  language: string
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
  const zh = input.language === 'zh'
  const workDetail = input.waitingApproval
    ? (zh ? '等待你批准下一项操作' : 'Waiting for approval')
    : input.currentToolName
      ? `${zh ? '正在使用' : 'Using'} ${input.currentToolName}`
      : input.completedToolCount > 0
        ? `${zh ? '已完成' : 'Completed'} ${input.completedToolCount} ${zh ? '次工具调用' : 'tool calls'}`
        : input.isRunning
          ? (zh ? '正在分析并执行任务' : 'Analyzing and executing')
          : input.isSuccess
            ? (zh ? '执行已结束' : 'Execution finished')
            : (zh ? '尚未开始' : 'Not started')

  return [
    {
      id: 'brief',
      label: zh ? '接收任务' : 'Receive brief',
      detail: input.hasThread || input.isError
        ? (zh ? '上下文已交给子代理' : 'Context handed to the sub-agent')
        : (zh ? '正在创建子代理' : 'Starting sub-agent'),
      state: input.hasThread || input.isError ? 'complete' : 'active',
    },
    {
      id: 'work',
      label: zh ? '执行任务' : 'Execute task',
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
      label: zh ? '回传结果' : 'Report back',
      detail: input.isSuccess
        ? (zh ? '结果已返回主任务' : 'Result returned to the parent task')
        : input.isError
          ? (zh ? '已返回失败信息' : 'Failure returned to the parent task')
          : (zh ? '等待执行完成' : 'Waiting for execution'),
      state: input.isSuccess ? 'complete' : input.isError ? 'error' : 'pending',
    },
  ]
}
