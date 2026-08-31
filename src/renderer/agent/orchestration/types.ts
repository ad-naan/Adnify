/**
 * Sub-agent 编排引擎类型定义
 *
 * 设计原则:
 * - 复用 runLoop + 隐藏线程,继承循环检测/上下文压缩/autoFix
 * - 子 agent 上下文隔离,只回传摘要结果,不污染主 agent
 * - 默认只读工具集,递归深度受限
 */

/**
 * 主 agent 调用 task 工具时传入的子代理请求
 */
export interface SubAgentRequest {
  /** 子任务的自然语言描述（会作为子 agent 的第一条 user 消息） */
  description: string
  /** 主 agent 提供的上下文摘要（可选），帮助子 agent 理解背景 */
  context?: string
  /** 子 agent 使用的 prompt 模板 ID（可选），默认 'concise' */
  promptTemplateId?: string
  /** 附加指令（可选），注入到子 agent 系统提示词 */
  customInstructions?: string
  /** 约束清单（可选），注入到子 agent 消息中 */
  constraints?: string[]
  /** 最大工具迭代次数（可选），默认由 budgetController 控制 */
  maxIterations?: number
  /** 超时毫秒数（可选），默认 5 分钟 */
  timeoutMs?: number
  /** Whether tools may mutate the repository. */
  writeCapable?: boolean
  /** Whether this execution may overlap another writer. */
  concurrent?: boolean
}

/**
 * 子 agent 执行结果
 */
export interface SubAgentResult {
  /** 子 agent 是否正常完成（而非被中止/出错/达到上限） */
  success: boolean
  /** 子 agent 的最终文本输出（已摘要） */
  output?: string
  /** 错误信息（若 success=false） */
  error?: string
  /** 子 agent 会话 ID */
  subAgentId: string
  /** 子 agent 运行所在的隐藏线程 ID */
  threadId?: string
  /** 子 agent 的助手消息 ID */
  assistantId?: string
  /** 实际运行时长（毫秒） */
  durationMs?: number
  worktree?: {
    path: string
    branch: string
    commit?: string
    merged?: boolean
    conflicts?: string[]
    /** 车道终态：合并 / 归档保留 / 无产出丢弃 / 出错 */
    outcome?: 'merged' | 'retained' | 'discarded' | 'failed'
    /** worktree 目录已回收，分支与提交仍可恢复 */
    archived?: boolean
  }
}

export interface SubAgentStartedInfo {
  subAgentId: string
  threadId: string
  requestId: string
  startedAt: number
}

export interface SubAgentLifecycleCallbacks {
  onStarted?: (info: SubAgentStartedInfo) => void
}

/**
 * 子 agent 运行状态
 */
export type SubAgentStatus = 'running' | 'completed' | 'failed' | 'aborted'
