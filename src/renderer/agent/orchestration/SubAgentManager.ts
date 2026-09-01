/**
 * SubAgent 编排管理器
 *
 * 职责：
 * - 在主 agent 循环中动态派生轻量级子代理（类似 Claude Code 的 Task 工具）
 * - 每个子代理运行在隔离的隐藏线程中，拥有独立上下文 / 预算 / 循环检测
 * - 收集子代理完成结果，以摘要形式回传给主 agent（不污染主上下文）
 *
 * 设计原则：
 * - 复用 Agent.send + runLoop，零重写，完整继承循环检测 / 上下文压缩 / autoFix
 * - 通过 createThread({ activate: false }) 创建隐藏线程，UI 操作经 forThread 隔离
 * - 通过 EventBus 监听 loop:end 收集完成信号（与 planExecutor 同一模式）
 * - 支持并行派生多个子代理
 *
 * 与 planExecutor 的区别：
 * - planExecutor 是「重型编排」：需要用户先创建 Plan / TaskBoard，每个任务指定 provider/model/role
 * - SubAgentManager 是「轻量编排」：主 agent 在循环中自由派生，类似函数调用，无需预定义
 */

import { useAgentStore } from '../store/AgentStore'
import { logger } from '@utils/Logger'
import { EventBus, isSuccessfulLoopEnd, isAbortedLoopEnd } from '../core/EventBus'
import { Agent } from '../core/Agent'
import type { LLMConfig } from '../core/types'
import type { WorkMode } from '@/renderer/modes/types'
import type { SubAgentLifecycleCallbacks, SubAgentRequest, SubAgentResult, SubAgentStatus } from './types'
import { ExecutionLaneCoordinator, type ExecutionLaneAssignment } from './ExecutionLaneCoordinator'
import type { WorktreeLaneCompletion } from './WorktreeLaneService'

/** 单个子代理的运行句柄 */
interface SubAgentHandle {
  id: string
  /** 原始任务描述，供 getActiveSubAgents 展示 */
  description: string
  threadId: string
  assistantId?: string
  requestId: string
  status: SubAgentStatus
  startedAt: number
  completedAt?: number
  abortController: AbortController
  laneAssignment?: ExecutionLaneAssignment
}

/** 默认超时：单个子代理最多运行 5 分钟 */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

/** 默认最大并行子代理数 */
const DEFAULT_MAX_CONCURRENCY = 3

/**
 * SubAgent 编排管理器（单例）
 *
 * 生命周期与主 agent 会话绑定。主 agent 通过 `task` 工具触发 spawnSubAgent，
 * 管理器负责创建隐藏线程、派发执行、收集结果。
 */
class SubAgentManagerClass {
  private activeHandles = new Map<string, SubAgentHandle>()
  private completionResolvers = new Map<string, (result: SubAgentResult) => void>()
  /**
   * 所有由本管理器创建过的隐藏线程 ID。
   *
   * 用途是递归硬拦截：spawn 收到 parentThreadId 时，如果这个线程本身就是我们
   * 建的子代理线程，直接拒绝。故意不在 settle 里清除 —— 线程被保留下来供用户
   * 回看，只要它还在就永远不该获得派生权。
   */
  private subAgentThreadIds = new Set<string>()

  /** 该线程是否是本管理器创建的子代理隐藏线程 */
  isSubAgentThread(threadId: string | null | undefined): boolean {
    if (!threadId) return false
    return this.subAgentThreadIds.has(threadId)
  }

  /**
   * 派生一个子代理并等待其完成
   *
   * @param request 子代理请求
   * @param config  LLM 配置（默认继承主 agent 的配置）
   * @param workspacePath 工作区路径
   * @param chatMode 工作模式（默认 agent）
   * @param parentThreadId 发起方所在线程 ID，用于拦截子代理再派生子代理
   * @returns 子代理执行结果（成功时包含摘要输出）
   */
  async spawn(
    request: SubAgentRequest,
    config: LLMConfig,
    workspacePath: string | null,
    chatMode: WorkMode = 'agent',
    parentThreadId?: string | null,
    lifecycle?: SubAgentLifecycleCallbacks,
  ): Promise<SubAgentResult> {
    const id = crypto.randomUUID()
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS

    // 递归硬拦截。工具加载那层（getToolsForContext 的 isSubAgent）只是不把
    // task 喂给模型，它是模块级单例、并发线程会互相覆盖，不能当唯一防线；
    // 这里按线程血缘判定，不受加载顺序影响。
    if (this.isSubAgentThread(parentThreadId)) {
      logger.agent.warn(`[SubAgent] Rejected nested spawn from sub-agent thread ${parentThreadId}`)
      return {
        success: false,
        error: 'Sub-agents cannot spawn further sub-agents. Do this work directly instead of delegating.',
        subAgentId: id,
      }
    }

    // 并发上限检查
    if (this.activeHandles.size >= DEFAULT_MAX_CONCURRENCY) {
      return {
        success: false,
        error: `Sub-agent concurrency limit reached (${DEFAULT_MAX_CONCURRENCY}). Wait for existing sub-agents to finish.`,
        subAgentId: id,
      }
    }

    logger.agent.info(`[SubAgent] Spawning sub-agent "${request.description.slice(0, 60)}" (id=${id})`)

    let laneAssignment: ExecutionLaneAssignment
    try {
      laneAssignment = await ExecutionLaneCoordinator.acquire({
        kind: 'sub-agent', workspacePath, label: request.description,
        mayWrite: request.writeCapable === true, concurrent: request.concurrent === true,
      })
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error), subAgentId: id }
    }

    // 1. 创建隐藏线程（不激活，不影响主 UI）
    const store = useAgentStore.getState()
    const parentThread = parentThreadId ? store.threads[parentThreadId] : undefined
    const threadId = store.createThread({
      activate: false,
      mode: chatMode,
      origin: 'sub-agent',
      parentThreadId: parentThreadId || undefined,
      rootThreadId: parentThread?.rootThreadId || parentThreadId || undefined,
    })
    const requestId = crypto.randomUUID()
    const abortController = new AbortController()

    // 登记血缘：这条线程往后再调 task 会被上面的硬拦截挡掉
    this.subAgentThreadIds.add(threadId)

    const handle: SubAgentHandle = {
      id,
      description: request.description,
      threadId,
      requestId,
      status: 'running',
      startedAt: Date.now(),
      abortController,
      laneAssignment,
    }
    this.activeHandles.set(id, handle)
    store.renameThread(threadId, `↳ ${request.description.slice(0, 72)}`)
    lifecycle?.onStarted?.({
      subAgentId: id,
      threadId,
      requestId,
      startedAt: handle.startedAt,
    })

    // 2. 设置完成监听（通过 EventBus 的 loop:end 事件）
    const completionPromise = this.setupCompletionListener(handle, timeoutMs)

    // 3. 构建子代理的初始消息（注入任务描述 + 约束）
    const message = this.buildSubAgentMessage(request)

    // 4. 派发执行（复用 Agent.send，绑定到隐藏线程）
    try {
      const execution = await Agent.send(
        message,
        config,
        laneAssignment.workspacePath,
        chatMode,
        {
          // 子代理使用简洁模板，不携带主 agent 的完整 skills / 上下文
          promptTemplateId: request.promptTemplateId || 'concise',
          customInstructions: request.customInstructions,
        },
        {
          threadId,
          requestId,
          // 让 runLoop / PromptBuilder 知道这是子代理，从工具集里剔掉 task 等
          isSubAgent: true,
        },
      )

      handle.assistantId = execution.assistantId
      logger.agent.info(`[SubAgent] Sub-agent ${id} dispatched on thread ${threadId}`)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.agent.error(`[SubAgent] Failed to dispatch sub-agent ${id}:`, error)
      this.settleWithLaneRelease(handle, 'sub-agent failed to start', {
        success: false,
        error: `Failed to start sub-agent: ${errorMsg}`,
        subAgentId: id,
      })
    }

    // 5. 等待完成
    const result = await completionPromise
    return result
  }

  /**
   * 并行派生多个子代理，等待全部完成
   *
   * @param requests 子代理请求列表
   * @param config LLM 配置
   * @param workspacePath 工作区路径
   * @param chatMode 工作模式
   * @param parentThreadId 发起方所在线程 ID，用于拦截子代理再派生子代理
   * @returns 每个子代理的结果（按请求顺序）
   */
  async spawnBatch(
    requests: SubAgentRequest[],
    config: LLMConfig,
    workspacePath: string | null,
    chatMode: WorkMode = 'agent',
    parentThreadId?: string | null,
  ): Promise<SubAgentResult[]> {
    // 分批控制并发，避免超出上限
    const results: SubAgentResult[] = []

    for (let i = 0; i < requests.length; i += DEFAULT_MAX_CONCURRENCY) {
      const batch = requests.slice(i, i + DEFAULT_MAX_CONCURRENCY)
      const batchResults = await Promise.all(
        batch.map(req => this.spawn(req, config, workspacePath, chatMode, parentThreadId)),
      )
      results.push(...batchResults)
    }

    return results
  }

  /**
   * 中止指定子代理
   */
  abort(subAgentId: string): void {
    const handle = this.activeHandles.get(subAgentId)
    if (!handle) return

    handle.abortController.abort()
    Agent.abort(handle.threadId)
    logger.agent.info(`[SubAgent] Aborted sub-agent ${subAgentId}`)
  }

  /**
   * 中止所有活跃子代理
   */
  abortAll(): void {
    for (const id of this.activeHandles.keys()) {
      this.abort(id)
    }
  }

  /**
   * 获取当前活跃子代理状态（用于 UI 展示）
   */
  getActiveSubAgents(): Array<{
    id: string
    description: string
    status: SubAgentStatus
    threadId: string
    elapsedMs: number
  }> {
    // description 直接取 handle 上记下的原始值。原来是去隐藏线程里找第一条 user
    // 消息再截 100 字 —— 那条消息是 buildSubAgentMessage 生成的 markdown，
    // 开头是 "# Sub-Agent Task\n\n## Objective\n"，截出来全是模板头，看不到任务。
    return Array.from(this.activeHandles.values()).map(handle => ({
      id: handle.id,
      description: handle.description,
      status: handle.status,
      threadId: handle.threadId,
      elapsedMs: Date.now() - handle.startedAt,
    }))
  }

  // ===== 内部方法 =====

  /**
   * 设置 loop:end 完成监听
   *
   * 复用 planExecutor 的 waitForAgentCompletion 模式：
   * 通过 EventBus 监听匹配 threadId + requestId 的 loop:end 事件
   */
  private setupCompletionListener(handle: SubAgentHandle, timeoutMs: number): Promise<SubAgentResult> {
    return new Promise<SubAgentResult>((resolve) => {
      let settled = false
      let finishing = false
      let timer: ReturnType<typeof setTimeout> | null = null

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        unsubscribe()
      }

      this.completionResolvers.set(handle.id, (result: SubAgentResult) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(result)
      })

      const unsubscribe = EventBus.on('loop:end', (event) => {
        if (event.threadId !== handle.threadId) return
        if (event.requestId !== handle.requestId) return
        if (finishing) return
        finishing = true

        // 用共享判定，不要在这里各自列举 reason。原来列的是失败项且含一个
        // 从不存在的 'failed'，于是 handoff_required / no_messages /
        // waiting_for_user 三种「没干完」都落进 else 被当成成功回传。
        const succeeded = isSuccessfulLoopEnd(event.reason)
        const isAborted = isAbortedLoopEnd(event.reason)

        handle.status = isAborted ? 'aborted' : succeeded ? 'completed' : 'failed'
        handle.completedAt = Date.now()

        if (isAborted) {
          this.settleWithLaneRelease(handle, 'sub-agent aborted', {
            success: false,
            error: 'Sub-agent was aborted',
            subAgentId: handle.id,
            threadId: handle.threadId,
            durationMs: Date.now() - handle.startedAt,
          })
          return
        }

        const output = this.extractOutput(handle)
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        unsubscribe()

        // 没成功的子代理也必须归还车道：否则 worktree 目录和分支会一直留在仓库里，
        // 并且残留会弄脏基准工作区，后续并行子代理全都建不出车道。
        if (!succeeded) {
          this.settleWithLaneRelease(handle, `sub-agent did not finish (${event.reason})`, {
            success: false,
            error: `Sub-agent did not finish (${event.reason})`,
            subAgentId: handle.id,
            threadId: handle.threadId,
            assistantId: handle.assistantId,
            durationMs: Date.now() - handle.startedAt,
          })
          return
        }

        void (async () => {
          const laneResult = handle.laneAssignment?.isolated
            ? await ExecutionLaneCoordinator.complete(handle.laneAssignment, `Adnify agent task: ${handle.description}`) || undefined
            : undefined
          // `retained` 不是失败：agent 干完了活，只是改动没能自动合并，提交仍在分支上
          // 等人工处理。把它当失败会连 output 一起丢掉 —— 那才是任务的真正答案。
          // 保留下来的车道通过 worktree 投影告诉调用方还需要合并。
          const laneFailed = Boolean(laneResult) && !laneResult!.success && laneResult!.outcome !== 'retained'
          this.settle(handle.id, {
            success: !laneFailed,
            output: laneFailed ? undefined : output || 'Sub-agent completed with no output.',
            error: laneResult?.error,
            subAgentId: handle.id,
            threadId: handle.threadId,
            assistantId: handle.assistantId,
            durationMs: Date.now() - handle.startedAt,
            worktree: this.laneProjection(handle, laneResult),
          })
        })()
      })

      timer = setTimeout(() => {
        if (settled) return
        logger.agent.warn(`[SubAgent] Sub-agent ${handle.id} timed out after ${timeoutMs}ms`)
        Agent.abort(handle.threadId)
        this.settleWithLaneRelease(handle, `sub-agent timed out after ${timeoutMs}ms`, {
          success: false,
          error: `Sub-agent timed out after ${timeoutMs}ms`,
          subAgentId: handle.id,
          threadId: handle.threadId,
        })
      }, timeoutMs)
    })
  }

  /**
   * 归还车道后再回传结果。
   *
   * 车道回收是异步的（提交 WIP → 删目录），但 settle 是同步的；把两者串起来，
   * 保证调用方拿到的 worktree 投影已经是终态，而不是一个还在的临时目录。
   */
  private settleWithLaneRelease(handle: SubAgentHandle, reason: string, result: SubAgentResult): void {
    void (async () => {
      const released = handle.laneAssignment?.isolated
        ? await ExecutionLaneCoordinator.release(handle.laneAssignment, reason) || undefined
        : undefined
      this.settle(handle.id, { ...result, worktree: this.laneProjection(handle, released) })
    })()
  }

  /** 把车道终态投影成回传给主 agent 的 worktree 元信息 */
  private laneProjection(handle: SubAgentHandle, completion?: WorktreeLaneCompletion) {
    if (completion) {
      return {
        path: completion.path || handle.laneAssignment?.lane?.path || '',
        branch: completion.branch || handle.laneAssignment?.lane?.branch || '',
        commit: completion.commit,
        merged: completion.merged,
        conflicts: completion.conflicts,
        outcome: completion.outcome,
        archived: completion.archived,
      }
    }
    const lane = handle.laneAssignment?.lane
    return lane ? { path: lane.path, branch: lane.branch } : undefined
  }

  /**
   * 从隐藏线程提取子代理的最终输出
   */
  private extractOutput(handle: SubAgentHandle): string {
    const store = useAgentStore.getState()
    const thread = store.threads[handle.threadId]
    if (!thread) return ''

    // 优先取指定 assistantId 的消息
    if (handle.assistantId) {
      const msg = thread.messages.find(m => m.id === handle.assistantId)
      if (msg?.role === 'assistant' && msg.content) {
        return msg.content
      }
    }

    // 回退：取最后一条 assistant 消息
    const lastAssistant = [...thread.messages].reverse().find(m => m.role === 'assistant')
    return lastAssistant?.role === 'assistant' ? (lastAssistant.content || '') : ''
  }

  /**
   * 结束子代理，清理资源并回传结果
   */
  private settle(subAgentId: string, result: SubAgentResult): void {
    // 隐藏线程有意保留：用户可以事后翻看子代理的完整对话。
    // 只摘掉活跃句柄，让并发额度立刻释放。
    this.activeHandles.delete(subAgentId)

    const resolver = this.completionResolvers.get(subAgentId)
    if (resolver) {
      this.completionResolvers.delete(subAgentId)
      resolver(result)
    }

    logger.agent.info(
      `[SubAgent] Settled ${subAgentId}: success=${result.success}, ${result.durationMs ?? 0}ms`,
    )
  }

  /**
   * 构建子代理的初始消息
   *
   * 注入任务描述、约束、期望输出格式，确保子代理聚焦且输出可回传
   */
  private buildSubAgentMessage(request: SubAgentRequest): string {
    const lines: string[] = []

    lines.push('# Sub-Agent Task')
    lines.push('')
    lines.push('## Objective')
    lines.push(request.description)
    lines.push('')

    if (request.context) {
      lines.push('## Context')
      lines.push(request.context)
      lines.push('')
    }

    lines.push('## Instructions')
    lines.push('1. Focus strictly on the objective above. Do not expand scope.')
    lines.push('2. Use available tools as needed to complete the task.')
    lines.push('3. Do NOT ask for user confirmation — execute autonomously.')
    lines.push('4. When done, provide a concise summary of your findings/results.')
    lines.push('5. Keep the final summary focused — it will be returned to the orchestrator.')
    lines.push('')

    if (request.constraints && request.constraints.length > 0) {
      lines.push('## Constraints')
      for (const c of request.constraints) {
        lines.push(`- ${c}`)
      }
      lines.push('')
    }

    if (request.maxIterations) {
      lines.push(`## Budget`)
      lines.push(`Maximum tool iterations: ${request.maxIterations}`)
      lines.push('')
    }

    return lines.join('\n')
  }
}

/** SubAgent 编排管理器单例 */
export const SubAgentManager = new SubAgentManagerClass()
