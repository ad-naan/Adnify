/**
 * Execution Domain - 执行领域
 *
 * 职责：
 * - 协调整个 Agent 执行流程
 * - 集成 Mode、Budget、Context、Message 领域
 * - 管理执行生命周期
 *
 * DDD 设计：
 * - AgentExecutor: 应用服务，协调各个领域服务
 * - ExecutionContext: 值对象，执行上下文
 */

import { logger } from '@utils/Logger'
import type { WorkMode } from '@/shared/types/workMode'
import type { MessageContent, ContextItem, ChatMessage } from '../types'
import type { LLMMessage } from '@/shared/types'
import { modeRegistry } from '../domains/mode/ModeRegistry'
import { createBudgetController } from '../domains/budget/TokenBudgetController'
import type { TokenBudgetController, BudgetReconciliation } from '../domains/budget/TokenBudgetController'
import { ContextAssembler } from '../domains/context/ContextAssembler'
import type { ContextAssemblyConfig } from '../domains/context/ContextAssembler'
import { MessageAssembler } from '../domains/message/MessageAssembler'
import type { CompressionLevel } from '../domains/context/CompressionManager'
import { countTokens } from '@shared/utils/tokenCounter'

// ===== Value Objects =====

/**
 * 执行配置（值对象）
 */
export interface ExecutionConfig {
  /** 工作模式 */
  mode: WorkMode
  /** 工作区路径 */
  workspacePath: string | null
  /** 线程 ID */
  threadId?: string
  /** 助手消息 ID */
  assistantId?: string
  /** 请求 ID */
  requestId?: string
  /** Plan 任务 ID */
  planTaskId?: string
  /** 上下文限制 */
  contextLimit?: number
  /** Plan 特定上下文 */
  planContext?: {
    planId?: string
    taskId?: string
    requirementsContent?: string
    dependencySummary?: Array<{
      taskId: string
      title: string
      summary: string
      status: 'completed' | 'failed' | 'skipped'
    }>
    taskObjective?: string
  }
}

/**
 * 执行准备结果（值对象）
 */
export interface ExecutionPreparation {
  /** LLM 消息列表 */
  messages: LLMMessage[]
  /** 应用的压缩等级 */
  compressionLevel: CompressionLevel
  /** 估算的总 token 数 */
  estimatedTokens: number
  /** 预算控制器（用于后续 reconciliation） */
  budgetController: TokenBudgetController
  /** 压缩统计 */
  compressionStats: {
    truncatedToolCalls: number
    clearedToolResults: number
    removedMessages: number
  }
}

// ===== Agent Executor (应用服务) =====

/**
 * Agent 执行器
 *
 * 职责：
 * - 协调 Mode、Budget、Context、Message 领域
 * - 准备 LLM 请求
 * - 处理 LLM 响应
 * - 管理执行生命周期
 */
export class AgentExecutor {
  private contextAssembler: ContextAssembler
  private messageAssembler: MessageAssembler

  constructor() {
    this.contextAssembler = new ContextAssembler()
    this.messageAssembler = new MessageAssembler()
  }

  /**
   * 准备执行
   *
   * 这是发送到 LLM 之前的核心流程：
   * 1. 获取模式描述符
   * 2. 创建预算控制器
   * 3. 组装上下文
   * 4. 组装用户消息
   * 5. 根据预算动态压缩
   * 6. 组装最终消息
   */
  async prepare(
    userMessage: MessageContent,
    contextItems: ContextItem[],
    messageHistory: ChatMessage[],
    systemPrompt: string,
    config: ExecutionConfig
  ): Promise<ExecutionPreparation> {
    const startTime = Date.now()

    // 1. 获取模式描述符
    const modeDescriptor = modeRegistry.getOrDefault(config.mode)
    logger.agent.info(`[AgentExecutor] Preparing execution for mode: ${modeDescriptor.displayName}`)

    // 2. 创建预算控制器
    const contextLimit = config.contextLimit || 128_000
    const budgetController = createBudgetController(config.mode, modeDescriptor, contextLimit)

    // 3. 组装上下文
    const contextConfig: ContextAssemblyConfig = {
      mode: config.mode,
      modeDescriptor,
      contextItems,
      userQuery: this.extractUserQuery(userMessage),
      assistantId: config.assistantId,
      threadId: config.threadId,
      workspacePath: config.workspacePath,
      planContext: config.planContext,
    }

    const contextResult = await this.contextAssembler.assemble(contextConfig)

    // 4. 组装用户消息
    const userMessageContent = this.messageAssembler.assembleUserMessage(
      userMessage,
      contextResult.content
    )

    // 5. 检查是否需要注入 handoff 上下文
    let handoffContext: string | undefined
    if (config.threadId) {
      const { useAgentStore } = await import('../store/AgentStore')
      const thread = useAgentStore.getState().threads[config.threadId]
      if (thread?.handoffContext) {
        handoffContext = thread.handoffContext
        logger.agent.info('[AgentExecutor] Injected handoff context')
      }
    }

    // 6. 计算各部分的 token
    const systemPromptTokens = countTokens(systemPrompt) + (handoffContext ? countTokens(handoffContext) : 0)
    const contextTokens = contextResult.totalTokens
    const userMessageTokens = userMessageContent.estimatedTokens

    // 7. 动态压缩：根据预算控制器决定压缩等级
    let compressionLevel: CompressionLevel = modeDescriptor.budgetProfile.initialCompressionLevel
    let messageResult = this.messageAssembler.assemble(
      messageHistory,
      userMessageContent,
      systemPrompt,
      compressionLevel,
      handoffContext
    )

    // 迭代压缩直到满足预算
    while (compressionLevel <= 4) {
      // 估算历史消息 token
      const historyTokens = messageResult.estimatedTokens - systemPromptTokens - userMessageTokens

      // 使用预算控制器评估
      const budgetEstimate = budgetController.estimate(
        systemPromptTokens,
        historyTokens,
        contextTokens,
        userMessageTokens
      )

      // 如果满足预算或已达最高压缩等级，退出
      if (!budgetEstimate.isExceeded || compressionLevel >= 4) {
        if (budgetEstimate.warning) {
          logger.agent.warn(`[AgentExecutor] ${budgetEstimate.warning}`)
        }
        break
      }

      // 升级压缩等级
      compressionLevel = (compressionLevel + 1) as CompressionLevel
      logger.agent.info(
        `[AgentExecutor] Upgrading compression: L${compressionLevel - 1} → L${compressionLevel} ` +
        `(${(budgetEstimate.usageRatio * 100).toFixed(1)}% > ${(modeDescriptor.budgetProfile.targetRatio * 100).toFixed(1)}% target)`
      )

      // 重新组装消息
      messageResult = this.messageAssembler.assemble(
        messageHistory,
        userMessageContent,
        systemPrompt,
        compressionLevel,
        handoffContext
      )
    }

    const duration = Date.now() - startTime
    logger.agent.info(
      `[AgentExecutor] Preparation complete in ${duration}ms: ` +
      `${messageResult.messages.length} messages, L${compressionLevel}, ~${messageResult.estimatedTokens} tokens`
    )

    return {
      messages: messageResult.messages,
      compressionLevel: messageResult.compressionLevel,
      estimatedTokens: messageResult.estimatedTokens,
      budgetController,
      compressionStats: messageResult.compressionStats,
    }
  }

  /**
   * 处理 LLM 响应后的预算 reconciliation
   */
  reconcile(
    budgetController: TokenBudgetController,
    actualInputTokens: number,
    actualOutputTokens: number,
    estimatedInputTokens: number
  ): BudgetReconciliation {
    return budgetController.reconcile(
      actualInputTokens,
      actualOutputTokens,
      estimatedInputTokens
    )
  }

  /**
   * 提取用户查询文本
   */
  private extractUserQuery(message: MessageContent): string {
    if (typeof message === 'string') {
      return message
    }

    return message
      .filter(p => p.type === 'text')
      .map(p => (p as any).text)
      .join('')
  }
}

// ===== Singleton =====

export const agentExecutor = new AgentExecutor()
