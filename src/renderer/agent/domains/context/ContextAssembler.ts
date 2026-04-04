/**
 * Context Domain - 上下文领域
 *
 * 职责：
 * - 上下文组装：从多个来源（文件、代码库、Web等）收集和组装上下文
 * - 上下文贡献：支持模式特定的上下文注入（plan context、dependency summary等）
 * - 上下文优先级：根据模式策略确定上下文优先级
 *
 * DDD 设计：
 * - ContextAssembler: 聚合根，协调上下文组装流程
 * - ContextContributor: 领域服务接口，提供上下文贡献
 * - ContextItem: 值对象，表示上下文项
 */

import { logger } from '@utils/Logger'
import type { WorkMode } from '@/shared/types/workMode'
import type { ModeDescriptor } from '../mode/ModeDescriptor'
import type { ContextItem } from '../../types'
import { buildContextContent as legacyBuildContextContent } from '../../llm/ContextBuilder'
import { countTokens } from '@shared/utils/tokenCounter'

// ===== Value Objects =====

/**
 * 上下文贡献（值对象）
 */
export interface ContextContribution {
  /** 贡献者 ID */
  contributorId: string
  /** 优先级（越高越优先，越不容易被压缩） */
  priority: number
  /** 内容 */
  content: string
  /** 是否受保护（不被压缩） */
  protected: boolean
  /** Token 估算 */
  estimatedTokens: number
}

/**
 * 上下文组装结果（值对象）
 */
export interface ContextAssemblyResult {
  /** 组装后的上下文内容 */
  content: string
  /** 所有贡献 */
  contributions: ContextContribution[]
  /** 总 token 数 */
  totalTokens: number
  /** 受保护的 token 数 */
  protectedTokens: number
}

/**
 * 上下文组装配置（值对象）
 */
export interface ContextAssemblyConfig {
  /** 模式 */
  mode: WorkMode
  /** 模式描述符 */
  modeDescriptor: ModeDescriptor
  /** 上下文项 */
  contextItems: ContextItem[]
  /** 用户查询 */
  userQuery?: string
  /** 助手 ID */
  assistantId?: string
  /** 线程 ID */
  threadId?: string
  /** 工作区路径 */
  workspacePath?: string | null
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

// ===== Context Contributor (领域服务接口) =====

/**
 * 上下文贡献者接口
 */
export interface ContextContributor {
  /** 贡献者 ID */
  readonly id: string

  /** 是否对当前模式启用 */
  isEnabled(mode: WorkMode): boolean

  /** 生成上下文贡献 */
  contribute(config: ContextAssemblyConfig): Promise<ContextContribution | null>
}

// ===== Built-in Contributors =====

/**
 * Plan 上下文贡献者
 */
export class PlanContextContributor implements ContextContributor {
  readonly id = 'plan-context'

  isEnabled(mode: WorkMode): boolean {
    return mode === 'plan'
  }

  async contribute(config: ContextAssemblyConfig): Promise<ContextContribution | null> {
    const { planContext } = config
    if (!planContext) return null

    const parts: string[] = []

    // 注入需求文档
    if (planContext.requirementsContent) {
      parts.push('### Plan Requirements\n')
      parts.push(planContext.requirementsContent)
      parts.push('\n')
    }

    // 注入任务目标
    if (planContext.taskObjective) {
      parts.push('### Current Task Objective\n')
      parts.push(planContext.taskObjective)
      parts.push('\n')
    }

    if (parts.length === 0) return null

    const content = parts.join('')
    return {
      contributorId: this.id,
      priority: 100, // 最高优先级
      content,
      protected: true, // 受保护
      estimatedTokens: countTokens(content),
    }
  }
}

/**
 * 依赖摘要贡献者
 */
export class DependencySummaryContributor implements ContextContributor {
  readonly id = 'dependency-summary'

  isEnabled(mode: WorkMode): boolean {
    return mode === 'plan'
  }

  async contribute(config: ContextAssemblyConfig): Promise<ContextContribution | null> {
    const { planContext } = config
    if (!planContext?.dependencySummary || planContext.dependencySummary.length === 0) {
      return null
    }

    const parts: string[] = ['### Upstream Task Results\n']

    for (const dep of planContext.dependencySummary) {
      const statusIcon = dep.status === 'completed' ? '✓' : dep.status === 'failed' ? '✗' : '○'
      parts.push(`\n**${statusIcon} ${dep.title}** (${dep.status})\n`)
      parts.push(dep.summary)
      parts.push('\n')
    }

    const content = parts.join('')
    return {
      contributorId: this.id,
      priority: 90, // 高优先级
      content,
      protected: true, // 受保护
      estimatedTokens: countTokens(content),
    }
  }
}

// ===== Context Assembler (聚合根) =====

/**
 * 上下文组装器
 *
 * 职责：
 * - 协调上下文组装流程
 * - 收集各个贡献者的上下文
 * - 按优先级合并上下文
 * - 应用模式特定的上下文策略
 */
export class ContextAssembler {
  private contributors: Map<string, ContextContributor> = new Map()

  constructor() {
    // 注册内置贡献者
    this.registerContributor(new PlanContextContributor())
    this.registerContributor(new DependencySummaryContributor())
  }

  /**
   * 注册上下文贡献者
   */
  registerContributor(contributor: ContextContributor): void {
    this.contributors.set(contributor.id, contributor)
    logger.agent.debug(`[ContextAssembler] Registered contributor: ${contributor.id}`)
  }

  /**
   * 组装上下文
   */
  async assemble(config: ContextAssemblyConfig): Promise<ContextAssemblyResult> {
    const { contextItems, userQuery, assistantId, threadId } = config

    // 1. 收集所有启用的贡献者的贡献
    const contributions = await this.collectContributions(config)

    // 2. 构建基础上下文（使用现有逻辑）
    const baseContext = await legacyBuildContextContent(
      contextItems,
      userQuery,
      assistantId,
      threadId
    )

    // 3. 如果有基础上下文，添加为贡献
    if (baseContext) {
      contributions.push({
        contributorId: 'base-context',
        priority: 50, // 中等优先级
        content: baseContext,
        protected: false,
        estimatedTokens: countTokens(baseContext),
      })
    }

    // 4. 按优先级排序（高优先级在前）
    contributions.sort((a, b) => b.priority - a.priority)

    // 5. 合并上下文
    const mergedContent = this.mergeContributions(contributions)

    // 6. 计算 token 统计
    const totalTokens = contributions.reduce((sum, c) => sum + c.estimatedTokens, 0)
    const protectedTokens = contributions
      .filter(c => c.protected)
      .reduce((sum, c) => sum + c.estimatedTokens, 0)

    logger.agent.info(
      `[ContextAssembler] Assembled context: ${contributions.length} contributions, ` +
      `${totalTokens} tokens (${protectedTokens} protected)`
    )

    return {
      content: mergedContent,
      contributions,
      totalTokens,
      protectedTokens,
    }
  }

  /**
   * 收集所有贡献
   */
  private async collectContributions(config: ContextAssemblyConfig): Promise<ContextContribution[]> {
    const contributions: ContextContribution[] = []

    for (const contributor of this.contributors.values()) {
      if (!contributor.isEnabled(config.mode)) {
        continue
      }

      try {
        const contribution = await contributor.contribute(config)
        if (contribution) {
          contributions.push(contribution)
          logger.agent.debug(`[ContextAssembler] Collected: ${contribution.contributorId}`)
        }
      } catch (error) {
        logger.agent.error(`[ContextAssembler] Contributor ${contributor.id} failed:`, error)
      }
    }

    return contributions
  }

  /**
   * 合并贡献
   */
  private mergeContributions(contributions: ContextContribution[]): string {
    if (contributions.length === 0) {
      return ''
    }

    const parts: string[] = []

    // 先添加受保护的贡献
    const protectedContributions = contributions.filter(c => c.protected)
    if (protectedContributions.length > 0) {
      parts.push('## Protected Context\n')
      for (const contribution of protectedContributions) {
        parts.push(contribution.content)
      }
      parts.push('\n')
    }

    // 再添加普通贡献
    const regularContributions = contributions.filter(c => !c.protected)
    for (const contribution of regularContributions) {
      parts.push(contribution.content)
    }

    return parts.join('\n')
  }
}
