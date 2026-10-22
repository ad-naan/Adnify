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
import { projectLane } from './laneProjection'

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
  finishing?: boolean
  cleanupCompletion?: () => void
  executionPromise?: Promise<unknown>
}

/**
 * 无活动超时窗口：子代理这么久没有任何进展（流式输出 / LLM 迭代 / 工具事件）
 * 才会被判定卡死。原来是纯墙钟 5 分钟 —— 干得再勤快也会在整 5 分钟时被杀，
 * 这是「子代理经常超时」的根因。真正卡死（等待一个永远不会来的事件）才会触到窗口。
 */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

/** 绝对生命上限：进展再频繁也不允许无限跑下去 */
const MAX_SUB_AGENT_DURATION_MS = 30 * 60 * 1000

/** 取消后给执行循环短暂收尾；未停止时不能删除仍在使用的车道。 */
const ABORT_GRACE_MS = 5 * 1000

/** 允许通过 task 参数申请的无活动窗口下限，避免传个 1 秒进来自杀 */
const MIN_TIMEOUT_MS = 60 * 1000

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
    const requestedTimeout = request.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const timeoutMs = Number.isFinite(requestedTimeout)
      ? Math.min(Math.max(requestedTimeout, MIN_TIMEOUT_MS), MAX_SUB_AGENT_DURATION_MS)
      : DEFAULT_TIMEOUT_MS
    const parentSignal = lifecycle?.abortSignal

    if (parentSignal?.aborted) {
      return { success: false, error: 'Sub-agent was cancelled because its parent task was cancelled', subAgentId: id }
    }
    if (this.isSubAgentThread(parentThreadId)) {
      logger.agent.warn(`[SubAgent] Rejected nested spawn from sub-agent thread ${parentThreadId}`)
      return {
        success: false,
        error: 'Sub-agents cannot spawn further sub-agents. Do this work directly instead of delegating.',
        subAgentId: id,
      }
    }
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

    // Cancellation may arrive while Git is creating the lane. Do not dispatch it.
    if (parentSignal?.aborted) {
      const error = 'Sub-agent was cancelled because its parent task was cancelled'
      const released = await ExecutionLaneCoordinator.release(laneAssignment, error)
      return { success: false, error, subAgentId: id, worktree: released ? projectLane(released) : undefined }
    }

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
    const handle: SubAgentHandle = {
      id, description: request.description, threadId, requestId,
      status: 'running', startedAt: Date.now(),
      abortController: new AbortController(), laneAssignment,
    }
    this.subAgentThreadIds.add(threadId)
    this.activeHandles.set(id, handle)
    store.renameThread(threadId, `↳ ${request.description.slice(0, 72)}`)

    // Install cancellation/completion before notifying the caller; onStarted can cancel synchronously.
    const completionPromise = this.setupCompletionListener(handle, timeoutMs)
    const onParentAbort = () => handle.abortController.abort('Sub-agent was cancelled because its parent task was cancelled')
    parentSignal?.addEventListener('abort', onParentAbort, { once: true })
    if (parentSignal?.aborted) onParentAbort()

    try {
      lifecycle?.onStarted?.({ subAgentId: id, threadId, requestId, startedAt: handle.startedAt })
      if (!handle.finishing) {
        const message = this.buildSubAgentMessage(request)
        let executionStopped!: () => void
        handle.executionPromise = new Promise<void>(resolve => { executionStopped = resolve })

        // Agent.send awaits the whole run, not just dispatch. Do not await it here:
        // otherwise a stuck run prevents even an already-resolved timeout from reaching task.
        void (async () => {
          try {
            const execution = await Agent.send(
              message, config, laneAssignment.workspacePath, chatMode,
              { promptTemplateId: request.promptTemplateId || 'concise', customInstructions: request.customInstructions },
              { threadId, requestId, isSubAgent: true },
            )
            handle.assistantId = execution.assistantId
            logger.agent.info(`[SubAgent] Sub-agent ${id} execution stopped on thread ${threadId}`)
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error)
            logger.agent.error(`[SubAgent] Execution failed for ${id}:`, error)
            this.settleWithLaneRelease(handle, 'sub-agent execution failed', {
              success: false, error: `Sub-agent execution failed: ${detail}`, subAgentId: id,
            })
          } finally {
            executionStopped()
          }
        })()
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      this.settleWithLaneRelease(handle, 'sub-agent failed to start', {
        success: false, error: `Failed to start sub-agent: ${detail}`, subAgentId: id,
      })
    }

    try {
      return await completionPromise
    } finally {
      parentSignal?.removeEventListener('abort', onParentAbort)
    }
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
    if (!handle || handle.finishing) return
    // The request-scoped listener claims completion and aborts only this Agent thread.
    handle.abortController.abort('Sub-agent was cancelled by user')
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
      let inactivityTimer: ReturnType<typeof setTimeout> | null = null

      const fireTimeout = (message: string) => {
        if (settled || handle.finishing) return
        logger.agent.warn(`[SubAgent] ${message} (thread ${handle.threadId})`)
        handle.abortController.abort(message)
      }
      const hardCapTimer = setTimeout(
        () => fireTimeout(`Sub-agent ${handle.id} exceeded the maximum duration of ${MAX_SUB_AGENT_DURATION_MS}ms`),
        MAX_SUB_AGENT_DURATION_MS,
      )
      const armInactivityTimer = () => {
        if (settled || handle.finishing) return
        if (inactivityTimer !== null) clearTimeout(inactivityTimer)
        inactivityTimer = setTimeout(
          () => fireTimeout(`Sub-agent ${handle.id} timed out after ${timeoutMs}ms of inactivity`),
          timeoutMs,
        )
      }
      const onProgress = (event: { threadId?: string }) => {
        if (event.threadId === handle.threadId) armInactivityTimer()
      }
      const progressUnsubscribers = [
        EventBus.on('stream:activity', onProgress),
        EventBus.on('loop:iteration', onProgress),
        EventBus.on('tool:running', onProgress),
        EventBus.on('tool:completed', onProgress),
        EventBus.on('tool:error', onProgress),
        EventBus.on('tool:rejected', onProgress),
      ]

      const onAbort = () => {
        if (handle.finishing) return
        const reason = handle.abortController.signal.reason
        const error = typeof reason === 'string' ? reason : 'Sub-agent was cancelled by user'
        // Claim the terminal state BEFORE aborting Agent: abort can synchronously emit loop:end.
        this.settleWithLaneRelease(handle, error, { success: false, error, subAgentId: handle.id })
        if (handle.executionPromise) {
          try {
            Agent.abort(handle.threadId)
          } catch (abortError) {
            logger.agent.warn(`[SubAgent] Unable to abort ${handle.id}:`, abortError)
          }
        }
      }

      const unsubscribe = EventBus.on('loop:end', (event) => {
        if (event.threadId !== handle.threadId || event.requestId !== handle.requestId || handle.finishing) return
        handle.assistantId = event.assistantId || handle.assistantId
        const succeeded = isSuccessfulLoopEnd(event.reason)
        if (!succeeded) {
          const error = event.error || (isAbortedLoopEnd(event.reason)
            ? event.reason === 'user_rejected'
              ? 'Sub-agent stopped because a tool was rejected'
              : 'Sub-agent was cancelled'
            : `Sub-agent did not finish (${event.reason})`)
          this.settleWithLaneRelease(handle, error, { success: false, error, subAgentId: handle.id })
          return
        }

        handle.finishing = true
        handle.status = 'completed'
        handle.completedAt = Date.now()
        cleanup()
        void (async () => {
          try {
            if (!await this.waitForExecutionStop(handle)) {
              const error = 'Sub-agent execution did not stop; its lane was left untouched for recovery.'
              this.settle(handle.id, { success: false, error, subAgentId: handle.id, worktree: this.preservedLane(handle, error) })
              return
            }
            const output = this.extractOutput(handle)
            const laneResult = handle.laneAssignment?.isolated
              ? await ExecutionLaneCoordinator.complete(handle.laneAssignment, `Adnify agent task: ${handle.description}`)
              : null
            // Work completed but automatic merge was blocked: keep the answer and the recovery projection.
            const laneFailed = Boolean(laneResult && !laneResult.success && laneResult.outcome !== 'retained')
            this.settle(handle.id, {
              success: !laneFailed,
              output: laneFailed ? undefined : output || 'Sub-agent completed with no output.',
              error: laneFailed ? laneResult?.error || 'Sub-agent completed, but its lane could not be finalized.' : undefined,
              subAgentId: handle.id,
              worktree: laneResult ? projectLane(laneResult) : undefined,
            })
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error)
            this.settle(handle.id, {
              success: false, error: `Unable to finalize sub-agent: ${detail}`, subAgentId: handle.id,
              worktree: this.preservedLane(handle, detail),
            })
          }
        })()
      })

      const cleanup = () => {
        if (inactivityTimer !== null) clearTimeout(inactivityTimer)
        inactivityTimer = null
        clearTimeout(hardCapTimer)
        unsubscribe()
        progressUnsubscribers.forEach(off => off())
        handle.abortController.signal.removeEventListener('abort', onAbort)
      }
      handle.cleanupCompletion = cleanup
      this.completionResolvers.set(handle.id, result => {
        if (settled) return
        settled = true
        cleanup()
        resolve(result)
      })
      handle.abortController.signal.addEventListener('abort', onAbort, { once: true })
      armInactivityTimer()
    })
  }

  /**
   * 归还车道后再回传结果。
   *
   * 车道回收是异步的（提交 WIP → 删目录），但 settle 是同步的；把两者串起来，
   * 保证调用方拿到的 worktree 投影已经是终态，而不是一个还在的临时目录。
   */
  private async waitForExecutionStop(handle: SubAgentHandle): Promise<boolean> {
    if (!handle.executionPromise) return true
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        handle.executionPromise.then(() => true, () => true),
        new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), ABORT_GRACE_MS) }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  private preservedLane(handle: SubAgentHandle, error: string, stillRunning = false): SubAgentResult['worktree'] {
    const lane = handle.laneAssignment?.lane
    return lane ? {
      status: 'failed', path: lane.path, branch: lane.branch, baseBranch: lane.baseBranch,
      archived: false, error,
      notice: stillRunning ? { code: 'laneStillRunning' } : { code: 'cleanupFailed', params: { branch: lane.branch } },
    } : undefined
  }

  
private settleWithLaneRelease(handle: SubAgentHandle, reason: string, result: SubAgentResult): void {
    if (handle.finishing || !this.activeHandles.has(handle.id)) return
    handle.finishing = true
    handle.status = handle.abortController.signal.aborted ? 'aborted' : 'failed'
    handle.completedAt = Date.now()
    handle.cleanupCompletion?.()
    void (async () => {
      try {
        if (!await this.waitForExecutionStop(handle)) {
          const error = `${result.error || reason}. Execution did not stop; the lane was left untouched for recovery.`
          this.settle(handle.id, { ...result, error, worktree: this.preservedLane(handle, error, true) })
          return
        }
        const released = handle.laneAssignment?.isolated
          ? await ExecutionLaneCoordinator.release(handle.laneAssignment, reason)
          : null
        this.settle(handle.id, { ...result, worktree: released ? projectLane(released) : undefined })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        logger.agent.error(`[SubAgent] Unable to release lane for ${handle.id}:`, error)
        this.settle(handle.id, {
          ...result, error: `${result.error || reason}. Lane cleanup failed: ${detail}`,
          worktree: this.preservedLane(handle, detail),
        })
      }
    })()
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
    const handle = this.activeHandles.get(subAgentId)
    if (!handle) return
    handle.cleanupCompletion?.()
    const completed = {
      ...result,
      threadId: result.threadId || handle.threadId,
      assistantId: result.assistantId || handle.assistantId,
      durationMs: result.durationMs ?? Date.now() - handle.startedAt,
    }
    // Keep hidden conversations for inspection; release only the active handle/quota.
    this.activeHandles.delete(subAgentId)
    const resolver = this.completionResolvers.get(subAgentId)
    if (resolver) {
      this.completionResolvers.delete(subAgentId)
      resolver(completed)
    }
    logger.agent.info(`[SubAgent] Settled ${subAgentId}: success=${completed.success}, ${completed.durationMs}ms`)
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
