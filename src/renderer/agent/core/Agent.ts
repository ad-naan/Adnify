/**
 * Agent 核心类
 * 
 * 职责：
 * - 提供统一的公共 API
 * - 管理 Agent 生命周期（运行状态、中止、清理）
 * - 协调所有子模块（MessageBuilder, runLoop, EventBus）
 * - 处理错误和异常情况
 * 
 * 使用示例：
 * ```typescript
 * await Agent.send(
 *   "你好",
 *   config,
 *   workspacePath,
 *   systemPrompt,
 *   'agent'
 * )
 * ```
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { AppError, formatErrorMessage } from '@/shared/errors'
import { useAgentStore } from '../store/AgentStore'
import {
  buildPersistedAgentSessionState,
  persistCriticalAgentSessionState,
  resumeAgentStorageWrites,
  suspendAgentStorageWrites,
} from '../store/agentStorage'
import { fileCacheService } from '../services/fileCacheService'
import { approvalService } from './approvalService'
import { EventBus } from './EventBus'
import { getActiveListenerCount } from './stream'
import type { WorkMode } from '@/renderer/modes/types'
import type { MessageContent, TextContent, ImageContent } from '../types'
import type { CheckpointImage } from '../types'
import type { LLMConfig, ExecutionContext } from './types'
import { agentExecutor } from '../application/AgentExecutor'
import type { ExecutionConfig } from '../application/AgentExecutor'
import { getAgentLanguage, translateAgentText } from '../utils/agentText'
import { getBuiltinProvider } from '@shared/config/providers'
import { ExecutionLaneCoordinator, type ExecutionLaneAssignment } from '../orchestration/ExecutionLaneCoordinator'
import { laneNoticeText, laneOutcomeText } from '../orchestration/laneNoticeText'
import { laneNeedsRecovery, projectLane } from '../orchestration/laneProjection'
import type { ExecutionLaneProjection } from '@shared/types/executionLane'

// 动态导入 runLoop 避免循环依赖
const importRunLoop = () => import('./loop').then(m => m.runLoop)

const importBuildAgentSystemPrompt = () => import('../prompts/PromptBuilder').then(m => m.buildAgentSystemPrompt)

export class AgentClass {
  /** 运行中的任务（按线程追踪） */
  private runningTasks: Map<string, {
    abortController: AbortController
    assistantId: string
    requestId?: string
    planTaskId?: string
  }> = new Map()

  // ===== 公共 API =====

  /**
   * 发送消息并运行 Agent
   * 
   * @param userMessage - 用户消息（文本或多模态内容）
   * @param config - LLM 配置
   * @param workspacePath - 工作区路径
   * @param chatMode - 工作模式（chat/agent/plan）
   * @param promptOptions - 构建系统提示词所需的元数据
   */
  async send(
    userMessage: MessageContent,
    config: LLMConfig,
    workspacePath: string | null,
    chatMode: WorkMode = 'agent',
    promptOptions?: {
      openFiles?: string[]
      activeFile?: string
      customInstructions?: string
      promptTemplateId?: string
      planPhase?: 'planning' | 'executing'
      mentionedSkills?: string[]
    },
    executionOptions?: {
      threadId?: string
      requestId?: string
      planTaskId?: string
      contextItems?: import('../types').ContextItem[]
      /** 该次执行是否为子代理（隐藏线程）。会剔除 task/ask_user 等工具。 */
      isSubAgent?: boolean
    }
  ): Promise<{ threadId: string; assistantId: string; requestId: string }> {
    const store = useAgentStore.getState()

    // 第一次对话时可能还没有 threadId，需要在 addUserMessage 后获取
    let threadId = executionOptions?.threadId || store.currentThreadId

    // 防止同一线程重复运行
    if (threadId && this.runningTasks.has(threadId)) {
      logger.agent.warn('[Agent] Thread already running, ignoring new request')
      throw new Error(`Thread ${threadId} is already running`)
    }

    const abortController = new AbortController()
    const requestId = executionOptions?.requestId || crypto.randomUUID()
    const contextItems = executionOptions?.contextItems ?? (threadId
      ? (store.threads[threadId]?.contextItems || [])
      : (store.getCurrentThread()?.contextItems || []))

    let persistSuspended = false
    let taskRegistered = false
    let assistantId = ''
    let laneAssignment: ExecutionLaneAssignment | undefined
    let executionWorkspacePath = workspacePath

    try {
      suspendAgentStorageWrites()
      persistSuspended = true
      // 1. 【性能关键】批量初始化消息环境（合并用户消息、助手气泡、上下文清理）
      const prepared = store.prepareExecution(userMessage, contextItems, executionOptions?.threadId)
      assistantId = prepared.assistantId
      const preparedThreadId = prepared.threadId

      threadId = preparedThreadId
      if (!threadId) {
        logger.agent.error('[Agent] No thread ID after prepareExecution')
        throw new Error('No thread ID after prepareExecution')
      }

      const preparedThread = useAgentStore.getState().threads[threadId]
      store.setThreadMetadata(threadId, {
        mode: chatMode,
        origin: preparedThread?.origin || (executionOptions?.isSubAgent ? 'plan-task' : 'user'),
        planId: preparedThread?.planId,
        taskId: preparedThread?.taskId,
      })

      const threadStore = useAgentStore.getState().forThread(threadId)
      threadStore.setExecutionMeta({
        requestId,
        assistantId,
        planTaskId: executionOptions?.planTaskId,
        loopState: 'running',
      })
      threadStore.setStreamState({ requestId, assistantId, phase: 'streaming', laneNotice: undefined })

      // 2. 记录任务并绑定助手消息 ID
      this.runningTasks.set(threadId, {
        abortController,
        assistantId,
        requestId,
        planTaskId: executionOptions?.planTaskId,
      })
      taskRegistered = true

      // A second top-level Agent execution may write concurrently with the
      // already-running task. Isolate it at the execution-node boundary. Plan
      // and sub-agent callers own their lanes through the same shared service.
      const isTopLevelAgent = chatMode === 'agent' && !executionOptions?.isSubAgent && !executionOptions?.planTaskId
      laneAssignment = await ExecutionLaneCoordinator.acquire({
        kind: 'agent-session', workspacePath, label: preparedThread?.title || `agent-${threadId.slice(0, 8)}`,
        mayWrite: isTopLevelAgent, concurrent: isTopLevelAgent && this.runningTasks.size > 1,
        // 用户连发两条消息不等于申明了并行写任务：拿不到隔离就退回共享工作区并提示，
        // 而不是把一次正常对话变成报错。
        allowSharedFallback: true,
      })
      executionWorkspacePath = laneAssignment.workspacePath
      if (laneAssignment.fallbackNotice) {
        threadStore.setStreamState({
          laneNotice: {
            type: 'warning',
            title: translateAgentText('worktreeLane.fallbackTitle'),
            message: laneNoticeText(laneAssignment.fallbackNotice, getAgentLanguage()),
            code: laneAssignment.fallbackNotice.code,
          },
        })
      }

      // 【核心优化】立即让出主线程，确保用户消息和助手气泡瞬间在 UI 渲染
      await new Promise(resolve => setTimeout(resolve, 0))

      // Local validation happens after the optimistic commit. OAuth resolution
      // stays centralized in the main-process credential service.
      if (getBuiltinProvider(config.provider)?.auth.type !== 'oauth' && !config.apiKey) {
        throw new Error(translateAgentText('apiKeyWarning'))
      }

      // 3. 提取提到的 Skills
      const mentionedSkills = contextItems
        .filter(item => item.type === 'Skill')
        .map(item => (item as import('../types').SkillContext).skillId)

      // 4. 构建系统提示词（异步执行）
      const buildAgentSystemPrompt = await importBuildAgentSystemPrompt()
      const { prompt: systemPrompt, runtimeEnvironment, activeSkills } = await buildAgentSystemPrompt(chatMode, executionWorkspacePath, {
        ...promptOptions,
        threadId,
        isSubAgent: executionOptions?.isSubAgent,
        mentionedSkills: mentionedSkills.length > 0 ? mentionedSkills : undefined,
      })

      // 将 auto 选中的 skills 追加到 assistant message（排除已 @mention 的）
      const mentionedSet = new Set(mentionedSkills)
      const autoSelectedSkills = activeSkills.filter(s => !mentionedSet.has(s.name))
      if (autoSelectedSkills.length > 0) {
        store.addSkillsToMessage(assistantId, autoSelectedSkills, threadId)
      }

      // 5. 创建检查点（用于撤销）
      const checkpointImages = this.extractCheckpointImages(userMessage)
      const messageText = typeof userMessage === 'string' ? userMessage.slice(0, 50) : 'User message'
      const userMessageId = useAgentStore.getState().threads[threadId]?.messages.filter(m => m.role === 'user').at(-1)?.id
      const checkpointId = userMessageId
        ? await store.createMessageCheckpoint(userMessageId, messageText, checkpointImages, contextItems, threadId)
        : undefined

      // 6. 使用 AgentExecutor 准备执行
      const executionConfig: ExecutionConfig = {
        mode: chatMode,
        workspacePath: executionWorkspacePath,
        threadId,
        assistantId,
        requestId,
        planTaskId: executionOptions?.planTaskId,
        contextLimit: config.contextLimit,
        model: config.model,
        runtimeEnvironment,
      }

      const preparation = await agentExecutor.prepare(
        userMessage,
        contextItems,
        store.threads[threadId]?.messages || [],
        systemPrompt,
        executionConfig
      )

      // 7. 开始流式响应
      store.setStreamPhase('streaming', threadId)

      // 8. 运行主循环
      const runLoop = await importRunLoop()
      const executionContext: ExecutionContext = {
        workspacePath: executionWorkspacePath,
        chatMode,
        planPhase: promptOptions?.planPhase,
        systemPrompt,
        abortSignal: abortController.signal,
        threadId,
        requestId,
        planTaskId: executionOptions?.planTaskId,
        checkpointId,
        isSubAgent: executionOptions?.isSubAgent,
      }
      await runLoop(config, preparation.messages, executionContext, assistantId, preparation.budgetController)

      if (laneAssignment.isolated) {
        // 被中止的运行不该自动合并：用户按下停止时车道里往往是半完成的编辑。
        // 归还车道会把已有改动提交到车道分支上再归档，之后仍然可以手工合并。
        if (abortController.signal.aborted) {
          const released = await ExecutionLaneCoordinator.release(laneAssignment, 'aborted by user')
          if (released?.outcome === 'retained') {
            this.showLaneNotice('info', translateAgentText('worktreeLane.retainedTitle'), laneOutcomeText(released, getAgentLanguage()), assistantId, threadId,
              { projection: projectLane(released), workspacePath })
          }
          return { threadId, assistantId, requestId }
        }

        const laneResult = await ExecutionLaneCoordinator.complete(laneAssignment, `Adnify agent task: ${preparedThread?.title || threadId}`)
        // 车道没能合并不代表这次运行失败了：工作已经安全地留在车道分支上。抛错会把
        // 整条助手消息标成错误、还会触发上层重试，所以这里降级成一条可见的提示。
        if (laneResult && !laneResult.success) {
          this.showLaneNotice(
            laneResult.outcome === 'retained' ? 'warning' : 'error',
            translateAgentText('worktreeLane.retainedTitle'),
            laneOutcomeText(laneResult, getAgentLanguage()),
            assistantId,
            threadId,
            { projection: projectLane(laneResult), workspacePath },
          )
        }
      }

      return { threadId, assistantId, requestId }
    } catch (error) {
      // 统一错误处理。失败路径必须归还车道，否则 worktree 目录和分支会永久残留，
      // 而且残留会弄脏基准工作区，让后续所有并行执行都建不出车道。
      const released = laneAssignment?.lane
        ? await ExecutionLaneCoordinator.release(laneAssignment, error instanceof Error ? error.message : 'execution failed')
        : null
      const laneProjection = released ? projectLane(released) : undefined
      const needsRecovery = Boolean(laneProjection && laneNeedsRecovery(laneProjection))
      // 车道的去向对用户是关键信息（提交还在不在？）。还需要人工处理的车道会紧接着
      // 渲染成一张恢复卡，原因文案和按钮都在卡里，不必再拼进错误消息重复一遍；已经
      // 清干净的车道没有卡片可挂，就把原因附在错误后面。
      const laneNote = released?.notice && !needsRecovery ? ` ${laneNoticeText(released.notice, getAgentLanguage())}` : ''
      const effectiveError = laneNote
        ? new Error(`${error instanceof Error ? error.message : String(error)}${laneNote}`)
        : error
      const appError = AppError.fromError(effectiveError)
      logger.agent.error('[Agent] Error:', appError.toJSON())
      this.showError(formatErrorMessage(appError), assistantId, threadId || undefined)
      if (laneProjection && needsRecovery && released) {
        this.showLaneNotice(
          'warning',
          translateAgentText('worktreeLane.retainedTitle'),
          laneOutcomeText(released, getAgentLanguage()),
          assistantId,
          threadId || undefined,
          { projection: laneProjection, workspacePath },
        )
      }
      throw error
    } finally {
      if (persistSuspended) {
        resumeAgentStorageWrites()
        void persistCriticalAgentSessionState(
          buildPersistedAgentSessionState(useAgentStore.getState())
        )
      }

      if (taskRegistered) {
        this.cleanupTask(threadId)
      }
    }
  }

  /**
   * 中止当前运行的 Agent
   * 
   * 会：
   * - 中止 LLM 请求
   * - 拒绝待审批的工具
   * - 更新所有运行中的工具状态为 error
   * - 清理资源
   */
  abort(threadId?: string): void {
    const store = useAgentStore.getState()
    const targetThreadId = threadId || store.currentThreadId

    // Captured BEFORE the runningTasks entry is removed below. Reading it after
    // the delete always yielded undefined, silently falling through to the
    // thread's stored requestId.
    let runningRequestId: string | undefined

    // 中止当前线程的任务
    if (targetThreadId && this.runningTasks.has(targetThreadId)) {
      const task = this.runningTasks.get(targetThreadId)!
      runningRequestId = task.requestId
      task.abortController.abort()

      const thread = store.threads[targetThreadId]
      if (task.assistantId && thread) {
        const msg = thread.messages.find(m => m.id === task.assistantId)
        if (msg?.role === 'assistant') {
          const assistantMsg = msg as import('../types').AssistantMessage
          for (const tc of assistantMsg.toolCalls || []) {
            if (['running', 'awaiting', 'pending'].includes(tc.status)) {
              store.updateToolCall(task.assistantId, tc.id, {
                status: 'error',
                error: 'Aborted by user',
                streamingState: undefined,
              }, targetThreadId)
            }
          }
        }
        store.finalizeAssistant(task.assistantId, targetThreadId)
      }

      this.runningTasks.delete(targetThreadId)
    }

    const thread = targetThreadId ? store.threads[targetThreadId] : store.getCurrentThread()
    const effectiveRequestId = targetThreadId
      ? runningRequestId
        || thread?.streamState?.requestId
        || thread?.executionMeta?.requestId
      : undefined

    api.llm.abort(effectiveRequestId)
    if (targetThreadId) {
      // Must be the SAME id used to abort the LLM request. Passing a different
      // one (previously executionMeta.requestId) could cancel one request while
      // rejecting the approval of another — and approvalService.reject(undefined)
      // falls back to the most recently registered key, which can belong to an
      // unrelated thread.
      approvalService.reject(effectiveRequestId)
    }

    if (thread) {
      for (const msg of thread.messages) {
        if (msg.role === 'assistant') {
          const assistantMsg = msg as import('../types').AssistantMessage
          if (assistantMsg.isStreaming) {
            store.finalizeAssistant(msg.id, thread.id)
          }
        }
      }
    }

    if (targetThreadId) {
      const threadStore = store.forThread(targetThreadId)
      threadStore.updateExecutionMeta({ loopState: 'aborted' })
      threadStore.setStreamPhase('idle')
      threadStore.clearExecutionMeta()
    } else {
      store.setStreamPhase('idle')
    }
  }

  /**
   * 批准当前待审批的工具
   */
  approve(requestId?: string, toolCallId?: string): void {
    const state = useAgentStore.getState()
    const currentThread = state.currentThreadId ? state.threads[state.currentThreadId] : undefined
    const effectiveRequestId = requestId
      || currentThread?.streamState?.requestId
      || currentThread?.executionMeta?.requestId

    if (effectiveRequestId) {
      approvalService.approve(effectiveRequestId, toolCallId)
    }
  }

  /** 在当前任务内批准完全相同的操作。 */
  approveForTask(requestId?: string, toolCallId?: string): void {
    const state = useAgentStore.getState()
    const currentThread = state.currentThreadId ? state.threads[state.currentThreadId] : undefined
    const effectiveRequestId = requestId
      || currentThread?.streamState?.requestId
      || currentThread?.executionMeta?.requestId

    if (effectiveRequestId) {
      approvalService.approveForTask(effectiveRequestId, toolCallId)
    }
  }

  /**
   * 拒绝当前待审批的工具
   */
  reject(requestId?: string, toolCallId?: string): void {
    const state = useAgentStore.getState()
    const currentThread = state.currentThreadId ? state.threads[state.currentThreadId] : undefined
    const effectiveRequestId = requestId
      || currentThread?.streamState?.requestId
      || currentThread?.executionMeta?.requestId

    if (effectiveRequestId) {
      approvalService.reject(effectiveRequestId, toolCallId)
    }
  }

  /**
   * 清除会话缓存
   * 
   * 用于：
   * - 切换工作区时清除缓存
   * - 手动刷新时清除缓存
   */
  clearSession(): void {
    fileCacheService.clear()
    EventBus.clear()
    logger.agent.info('[Agent] Session cleared')
  }

  /**
   * 获取诊断信息（用于调试）
   */
  getDiagnostics() {
    return {
      runningTaskCount: this.runningTasks.size,
      runningThreadIds: Array.from(this.runningTasks.keys()),
      activeListeners: getActiveListenerCount(),
      cacheStats: fileCacheService.getStats(),
    }
  }

  /**
   * 检查是否有任务正在运行
   */
  get running(): boolean {
    return this.runningTasks.size > 0
  }

  /**
   * 检查指定线程是否正在运行
   */
  isThreadRunning(threadId: string): boolean {
    return this.runningTasks.has(threadId)
  }

  /**
   * 获取 EventBus（用于外部订阅）
   */
  get events() {
    return EventBus
  }

  // ===== 文件缓存 API =====

  /**
   * 检查文件是否有有效缓存
   */
  hasValidFileCache(filePath: string): boolean {
    return fileCacheService.hasValidCache(filePath)
  }

  /**
   * 标记文件已读取（用于缓存）
   */
  markFileAsRead(filePath: string, content: string): void {
    fileCacheService.markFileAsRead(filePath, content)
  }

  /**
   * 获取文件缓存哈希
   */
  getFileCacheHash(filePath: string): string | null {
    return fileCacheService.getFileHash(filePath)
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats() {
    return fileCacheService.getStats()
  }

  // ===== 私有方法 =====

  /**
   * 从消息中提取文本查询
   */
  // @ts-expect-error - Method kept for potential future use
  private extractUserQuery(message: MessageContent): string {
    if (typeof message === 'string') return message
    if (Array.isArray(message)) {
      return message
        .filter(p => p.type === 'text')
        .map(p => (p as TextContent).text)
        .join('')
    }
    return ''
  }

  /**
   * 从消息中提取图片（用于检查点）
   */
  private extractCheckpointImages(message: MessageContent): CheckpointImage[] {
    if (typeof message === 'string') return []
    if (Array.isArray(message)) {
      return message
        .filter((p): p is ImageContent => p.type === 'image')
        .map(p => ({
          id: crypto.randomUUID(),
          mimeType: (p.source.media_type || 'image/png') as string,
          base64: p.source.data,
        }))
    }
    return []
  }

  /**
   * 显示错误消息给用户
   */
  private showError(message: string, assistantId?: string, threadId?: string): void {
    const store = useAgentStore.getState()
    const id = assistantId || store.addAssistantMessage('', threadId)
    store.addSystemAlertPart(id, {
      alertType: 'error',
      title: translateAgentText('error'),
      message,
    }, threadId)
    store.finalizeAssistant(id, threadId)
  }

  /**
   * 车道相关的提示。
   *
   * 和 showError 的区别：不 finalize 助手消息 —— 车道提示可能在运行开始时就发出
   * （退回共享工作区），此时这条消息还要继续流式输出。
   *
   * `lane` 是可选的：带上它，这条提示会在聊天里就地长出恢复面板（重试合并 / 丢弃）。
   * 顶层会话没有任务卡，不给这个入口的话未合并的提交只能靠用户自己去命令行找。
   */
  private showLaneNotice(
    alertType: 'warning' | 'error' | 'info',
    title: string,
    message: string,
    assistantId?: string,
    threadId?: string,
    lane?: { projection: ExecutionLaneProjection, workspacePath: string | null },
  ): void {
    const store = useAgentStore.getState()
    const id = assistantId || store.addAssistantMessage('', threadId)
    store.addSystemAlertPart(id, {
      alertType,
      title,
      message,
      lane: lane && laneNeedsRecovery(lane.projection) ? lane.projection : undefined,
      laneWorkspacePath: lane?.workspacePath || undefined,
    }, threadId)
  }

  /**
   * 清理资源
   * 
   * 在以下情况调用：
   * - 正常完成（finally 块）
   * - 用户中止（abort 方法）
   * - 发生错误（finally 块）
   */
  /**
   * 清理指定线程的任务资源（唯一的"完成"处理点）
   * 
   * 职责：
   * - 完成助手消息（设置 isStreaming: false）
   * - 重置流状态（设置 phase: 'idle'）
   * - 清理任务记录
   */
  private cleanupTask(threadId: string | null): void {
    const store = useAgentStore.getState()

    if (threadId && this.runningTasks.has(threadId)) {
      const task = this.runningTasks.get(threadId)!
      if (task.assistantId) {
        store.finalizeAssistant(task.assistantId, threadId)
      }
      this.runningTasks.delete(threadId)
    }

    // 重置该线程的流状态
    if (threadId) {
      const threadStore = store.forThread(threadId)
      threadStore.setStreamPhase('idle')
      threadStore.clearExecutionMeta()
    }
  }

}

// 导出单例
export const Agent = new AgentClass()
