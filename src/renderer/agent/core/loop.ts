/**
 * Agent 主循环
 * 
 * 职责：
 * - 管理 LLM 调用循环
 * - 基于真实 token 使用量的上下文压缩
 * - 工具执行协调
 * - 循环检测
 * - 发布事件到 EventBus
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { performanceMonitor, withRetry, isRetryableError } from '@shared/utils'
import { useAgentStore } from '../store/AgentStore'
import { useStore } from '@store'
import { toolManager, initializeToolProviders, setToolLoadingContext, initializeTools } from '../tools'
import { getAgentConfig, READ_TOOLS } from '../utils/AgentConfig'
import { LoopDetector } from '../utils/LoopDetector'
import { getReadOnlyTools, isFileEditTool } from '@/shared/config/tools'
import { pathStartsWith, joinPath } from '@shared/utils/pathUtils'
import { createStreamProcessor } from './stream'
import { executeTools } from './tools'
import { EventBus } from './EventBus'
import {
  generateSummary,
  generateHandoffDocument,
} from '../domains/context'
import { updateStats, LEVEL_NAMES, estimateMessagesTokens } from '../domains/context/CompressionManager'
import { lintService } from '../services/lintService'
import type { TokenBudgetController } from '../domains/budget/TokenBudgetController'
import type { LintCheckFile } from '../types'
import type { ChatMessage } from '../types'
import type { LLMMessage } from '@/shared/types'
import type { WorkMode } from '@/renderer/modes/types'
import type { LLMConfig, LLMCallResult, ExecutionContext } from './types'
import type { LoopCheckResult } from './types'
import { t } from '@/renderer/i18n'

// ===== 告警文案 =====

/**
 * 根据当前界面语言返回对应文案，避免同类告警散落在多处硬编码。
 */
function getLocalizedText(language: string, zh: string, en: string): string {
  return language === 'zh' ? zh : en
}

function translate(language: string, key: Parameters<typeof t>[0], params?: Record<string, string | number>): string {
  return t(key, language as 'en' | 'zh', params)
}

function getLoopCheckMessage(language: string, loopCheck: LoopCheckResult): string {
  const details = loopCheck.details
  if (!details) {
    return loopCheck.reason || loopCheck.warning || translate(language, 'agent.loop.generic')
  }

  switch (details.category) {
    case 'exact_repeat':
      return translate(language, 'agent.loop.exactRepeat', {
        tool: details.toolName || 'tool',
        count: details.count || 0,
      })
    case 'same_tool_warning':
      return translate(language, 'agent.loop.sameToolWarning', {
        tool: details.toolName || 'tool',
        count: details.count || 0,
      })
    case 'content_cycle':
      return translate(language, 'agent.loop.contentCycle', {
        target: details.target || '',
        count: details.count || 0,
        states: Math.max(1, details.threshold || 0),
      })
    case 'pattern_loop':
      return translate(language, 'agent.loop.patternLoop', {
        pattern: details.pattern || '',
      })
    default:
      return loopCheck.reason || loopCheck.warning || translate(language, 'agent.loop.generic')
  }
}

function getLoopCheckSuggestion(language: string, loopCheck: LoopCheckResult): string | undefined {
  const details = loopCheck.details
  switch (details?.category) {
    case 'exact_repeat':
      return translate(language, 'agent.loop.suggestion.exactRepeat')
    case 'same_tool_warning':
      return translate(language, 'agent.loop.suggestion.sameToolWarning')
    case 'content_cycle':
      return translate(language, 'agent.loop.suggestion.contentCycle')
    case 'pattern_loop':
      return translate(language, 'agent.loop.suggestion.patternLoop')
    default:
      return loopCheck.suggestion
  }
}

function buildSoftLimitFeedback(
  language: string,
  title: string,
  detail: string,
  suggestion?: string
): string {
  if (language === 'zh') {
    return [
      `系统警告：${title}`,
      detail,
      suggestion ? `建议：${suggestion}` : '',
      '你本轮接下来禁止继续调用任何工具。',
      '不要中止会话，也不要把这次限制当作致命错误。',
      '请基于当前已有信息直接完成收束。',
      '优先输出当前结论、已完成内容、缺失信息，或更高效的下一步方案。',
    ].filter(Boolean).join('\n')
  }

  return [
    `System warning: ${title}`,
    detail,
    suggestion ? `Suggestion: ${suggestion}` : '',
    'You must not call any more tools in this turn.',
    'Do not abort the conversation and do not treat this limit as a fatal error.',
    'Finish by concluding with the information already available.',
    'Prioritize the current conclusion, completed work, missing information, or a more efficient next step.',
  ].filter(Boolean).join('\n')
}

function formatLoopDiagnostic(language: string, loopCheck?: LoopCheckResult): string {
  const details = loopCheck?.details
  if (!details) {
    return ''
  }

  const lines: string[] = []

  if (language === 'zh') {
    lines.push('诊断信息：')
    lines.push(`- 类型：${details.category}`)
    if (details.toolName) lines.push(`- 工具：${details.toolName}`)
    if (typeof details.count === 'number') lines.push(`- 次数：${details.count}`)
    if (typeof details.threshold === 'number') lines.push(`- 阈值：${details.threshold}`)
    if (details.target) lines.push(`- 目标：${details.target}`)
    if (details.pattern) lines.push(`- 模式：${details.pattern}`)
  } else {
    lines.push('Diagnostics:')
    lines.push(`- Category: ${details.category}`)
    if (details.toolName) lines.push(`- Tool: ${details.toolName}`)
    if (typeof details.count === 'number') lines.push(`- Count: ${details.count}`)
    if (typeof details.threshold === 'number') lines.push(`- Threshold: ${details.threshold}`)
    if (details.target) lines.push(`- Target: ${details.target}`)
    if (details.pattern) lines.push(`- Pattern: ${details.pattern}`)
  }

  return lines.join('\n')
}

// ===== 模式后处理钩子 =====

/**
 * 执行模式后处理钩子
 */
function executeModePostProcessHook(
  mode: WorkMode,
  context: Parameters<import('@shared/config/agentConfig').ModePostProcessHook>[0]
): ReturnType<import('@shared/config/agentConfig').ModePostProcessHook> {
  const agentConfig = getAgentConfig()
  const hookConfig = agentConfig.modePostProcessHooks?.[mode]

  if (!hookConfig?.enabled || !hookConfig.hook) {
    return null
  }

  try {
    return hookConfig.hook(context)
  } catch (error) {
    logger.agent.error(`[Loop] Mode post-process hook error for ${mode}:`, error)
    return null
  }
}

// ===== LLM 调用 =====

/**
 * 调用 LLM 并处理流式响应
 *
 * @param config - LLM 配置
 * @param messages - 消息历史
 * @param assistantId - 助手消息 ID
 * @param threadStore - 线程绑定的 Store
 * @param requestId - 请求标识，用于多对话隔离
 * @param tools - 预计算的工具定义（由 runLoop 初始化一次，避免每轮重复初始化）
 * @returns LLM 调用结果
 */
async function callLLM(
  config: LLMConfig,
  messages: LLMMessage[],
  assistantId: string | null,
  threadStore: import('../store/AgentStore').ThreadBoundStore,
  requestId: string,
  tools: import('@/shared/types/llm').ToolDefinition[],
  options?: {
    allowToolCalls?: boolean
  }
): Promise<LLMCallResult> {
  performanceMonitor.start(`llm:${config.model}`, 'llm', { provider: config.provider, messageCount: messages.length })

  const processor = createStreamProcessor(assistantId, threadStore, requestId, options)

  try {
    // 发送请求（携带 requestId 用于多对话隔离）
    await api.llm.send({
      config: config as import('@shared/types/llm').LLMConfig,
      messages: messages as LLMMessage[],
      tools,
      systemPrompt: '',
      requestId
    })

    // 等待流式响应完成
    const result = await processor.wait()
    performanceMonitor.end(`llm:${config.model}`, !result.error)

    // 更新 usage
    if (assistantId && result.usage) {
      useAgentStore.getState().updateMessage(assistantId, {
        usage: result.usage
      } as Partial<import('../types').AssistantMessage>)
    } else if (assistantId && !result.usage) {
      logger.agent.warn('[Loop] No usage data in LLM result')
    }

    processor.cleanup()
    return result
  } catch (error) {
    processor.cleanup()
    logger.agent.error('[Loop] Error in callLLM:', error)

    const errorMsg = error instanceof Error ? error.message : String(error)
    return { error: errorMsg }
  }
}

async function callLLMWithRetry(
  config: LLMConfig,
  messages: LLMMessage[],
  assistantId: string | null,
  threadStore: import('../store/AgentStore').ThreadBoundStore,
  abortSignal?: AbortSignal,
  requestId?: string,
  tools: import('@/shared/types/llm').ToolDefinition[] = [],
  options?: {
    allowToolCalls?: boolean
  }
): Promise<LLMCallResult> {
  const retryConfig = getAgentConfig()
  // 确保有 requestId（后备生成）
  const reqId = requestId || crypto.randomUUID()
  try {
    return await withRetry(
      async () => {
        if (abortSignal?.aborted) throw new Error('Aborted')

        // 记录重试前的消息状态快照，用于在失败时回滚幽灵工具调用
        let snapshot = null
        if (assistantId) {
          const msg = threadStore.getMessages().find(m => m.id === assistantId)
          if (msg && msg.role === 'assistant') {
            snapshot = {
              content: msg.content,
              parts: [...(msg.parts || [])],
              toolCalls: [...(msg.toolCalls || [])],
            }
          }
        }

        try {
          const result = await callLLM(config, messages, assistantId, threadStore, reqId, tools, options)

          // 工具调用解析错误不应该导致重试，而是返回给 AI 让它反思
          if (result.error) {
            const errorMsg = result.error.toLowerCase()
            const isToolParseError = errorMsg.includes('tool call parse') ||
              errorMsg.includes('invalid input for tool') ||
              errorMsg.includes('type validation failed')

            if (isToolParseError) {
              logger.agent.warn('[Loop] Tool parse error, will be handled in loop:', result.error)
              return result
            }

            // 其他错误：抛出以触发重试
            throw new Error(result.error)
          }

          return result
        } catch (err) {
          // 发生错误准备重试时，恢复消息状态，清除残留的流式工具和文本
          if (assistantId && snapshot) {
            threadStore.updateMessage(assistantId, snapshot)
          }
          throw err
        }
      },
      {
        maxRetries: retryConfig.maxRetries,
        initialDelayMs: retryConfig.retryDelayMs,
        backoffMultiplier: retryConfig.retryBackoffMultiplier,
        isRetryable: error => {
          const msg = error instanceof Error ? error.message : String(error)
          return isRetryableError(error) && msg !== 'Aborted'
        },
        onRetry: (attempt, error, delay) =>
          logger.agent.info(`[Loop] LLM retry ${attempt}, waiting ${delay}ms...`, error),
      }
    )
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

// ===== 自动修复 =====

/** autoFix 结果 */
interface AutoFixResult {
  /** 注入给 LLM 的错误描述 */
  content: string
  /** 结构化的检查结果（用于 UI） */
  files: LintCheckFile[]
}

/**
 * 检查编辑过的文件是否有 lint 错误
 *
 * @returns 结构化结果（null 表示无错误）
 */
async function autoFix(
  toolCalls: any[],
  workspacePath: string,
): Promise<AutoFixResult | null> {
  const writeToolCalls = toolCalls.filter(tc => !READ_TOOLS.includes(tc.name))
  if (writeToolCalls.length === 0) return null

  const editedFiles = writeToolCalls
    .filter(tc => isFileEditTool(tc.name))
    .map(tc => {
      const path = tc.arguments.path as string
      return pathStartsWith(path, workspacePath) ? path : joinPath(workspacePath, path)
    })
    .filter(path => !path.endsWith('/'))

  if (editedFiles.length === 0) return null

  const uniqueEditedFiles = Array.from(new Set(editedFiles))
  const lintResults = await lintService.getLintErrorsForFiles(uniqueEditedFiles, true)
  const allFiles: LintCheckFile[] = []

  for (const filePath of uniqueEditedFiles) {
    const result = lintResults.get(filePath)
    const errorItems = (result?.errors || []).filter(e => e.severity === 'error')
    allFiles.push({
      filePath,
      errors: errorItems.map(e => ({ severity: e.severity as 'error' | 'warning', message: e.message, line: e.startLine ?? 1 })),
    })
  }

  const filesWithErrors = allFiles.filter(f => f.errors.length > 0)
  if (filesWithErrors.length === 0) return null

  // 构建注入给 LLM 的文本
  const lines = filesWithErrors.map(f => {
    const errLines = f.errors.map(e => `  [${e.severity}] Line ${e.line}: ${e.message}`).join('\n')
    return `File: ${f.filePath}\n${errLines}`
  })
  const content = `Auto-check detected lint errors in ${filesWithErrors.length} file(s). Please fix them:\n\n${lines.join('\n\n')}`

  return { content, files: allFiles }
}

// ===== 压缩检查与处理 =====

interface CompressionCheckResult {
  level: 0 | 1 | 2 | 3 | 4
  needsHandoff: boolean
}

/**
 * 检查并处理压缩
 *
 * 在 LLM 返回后调用，根据真实 token 使用量更新压缩统计
 */
async function checkAndHandleCompression(
  usage: { input: number; output: number },
  contextLimit: number,
  store: ReturnType<typeof useAgentStore.getState>,
  threadStore: import('../store/AgentStore').ThreadBoundStore,
  context: ExecutionContext,
  assistantId: string,
  enableLLMSummary: boolean,
  autoHandoff: boolean,
  budgetController?: TokenBudgetController
): Promise<CompressionCheckResult> {
  const thread = store.getCurrentThread()
  const messageCount = thread?.messages.length || 0

  // Use budget controller for reconciliation if available
  if (budgetController) {
    const reconciliation = budgetController.reconcile(
      usage.input,
      usage.output,
      usage.input // TODO: Pass actual estimated tokens from pipeline
    )

    logger.agent.info(
      `[Compression] L${reconciliation.calculatedLevel} (${LEVEL_NAMES[reconciliation.calculatedLevel]}), ` +
      `ratio: ${(reconciliation.actualUsageRatio * 100).toFixed(1)}%, ` +
      `tokens: ${reconciliation.actualInputTokens + reconciliation.actualOutputTokens}/${contextLimit}`
    )

    // Update store with new stats
    const newStats = updateStats(
      { promptTokens: usage.input, completionTokens: usage.output },
      contextLimit,
      thread?.compressionStats || null,
      messageCount
    )
    threadStore.setCompressionStats(newStats as import('../domains/context/CompressionManager').CompressionStats)
    threadStore.setCompressionPhase('idle')

    // L3 warning
    if (reconciliation.calculatedLevel === 3 && (!thread?.compressionStats || thread.compressionStats.level < 3)) {
      const remainingTurns = budgetController.estimateRemainingTurns(usage.input, usage.output)
      EventBus.emit({
        type: 'context:warning',
        level: 3,
        message: `Context usage is high (${(reconciliation.actualUsageRatio * 100).toFixed(1)}%). Estimated ${remainingTurns} turns remaining.`,
      })
    }

    // L3: Generate summary if recommended
    if (reconciliation.shouldGenerateSummary && thread) {
      threadStore.setCompressionPhase('summarizing')
      try {
        const userTurns = thread.messages.filter(m => m.role === 'user').length
        const summaryResult = await generateSummary(thread.messages, { type: 'detailed' })
        threadStore.setContextSummary({
          objective: summaryResult.objective,
          completedSteps: summaryResult.completedSteps,
          pendingSteps: summaryResult.pendingSteps,
          decisions: [],
          fileChanges: summaryResult.fileChanges,
          errorsAndFixes: [],
          userInstructions: [],
          generatedAt: Date.now(),
          turnRange: [0, userTurns],
        })
        EventBus.emit({ type: 'context:summary', summary: summaryResult.summary })
      } catch {
        // Summary generation failed, not critical
      }
      threadStore.setCompressionPhase('idle')
    }

    // L4: Generate handoff if recommended
    if (reconciliation.shouldGenerateHandoff) {
      if (thread && context.workspacePath) {
        threadStore.setCompressionPhase('summarizing')
        try {
          const handoff = await generateHandoffDocument(thread.id, thread.messages, context.workspacePath)
          store.setHandoffDocument(handoff)
          EventBus.emit({ type: 'context:handoff', document: handoff })
        } catch {
          // Handoff generation failed, not critical
        }
        threadStore.setCompressionPhase('idle')
      }

      const { language } = useStore.getState()
      threadStore.addSystemAlertPart(assistantId, {
        alertType: 'warning',
        title: getLocalizedText(language, '上下文已满', 'Context Limit Reached'),
        message: getLocalizedText(language, '当前对话已达到上下文限制，请开始新会话继续。', 'Please start a new session to continue.'),
      })
      threadStore.setHandoffRequired(true)
    }

    EventBus.emit({
      type: 'context:level',
      level: reconciliation.calculatedLevel,
      tokens: reconciliation.actualInputTokens + reconciliation.actualOutputTokens,
      ratio: reconciliation.actualUsageRatio
    })

    return {
      level: reconciliation.calculatedLevel,
      needsHandoff: reconciliation.isLimitReached
    }
  }

  // Fallback to legacy logic if no budget controller
  const previousStats = thread?.compressionStats || null
  const newStats = updateStats(
    { promptTokens: usage.input, completionTokens: usage.output },
    contextLimit,
    previousStats,
    messageCount
  )

  const calculatedLevel = newStats.level

  logger.agent.info(
    `[Compression] L${calculatedLevel} (${LEVEL_NAMES[calculatedLevel]}), ` +
    `ratio: ${(newStats.ratio * 100).toFixed(1)}%, ` +
    `tokens: ${newStats.inputTokens + newStats.outputTokens}/${contextLimit}`
  )

  threadStore.setCompressionStats(newStats as import('../domains/context/CompressionManager').CompressionStats)
  threadStore.setCompressionPhase('idle')

  // L3 warning
  if (calculatedLevel === 3 && (!previousStats || previousStats.level < 3)) {
    const remainingRatio = 1 - newStats.ratio
    const estimatedRemainingTurns = Math.floor(remainingRatio * contextLimit / (usage.input + usage.output))
    EventBus.emit({
      type: 'context:warning',
      level: 3,
      message: `Context usage is high (${(newStats.ratio * 100).toFixed(1)}%). Estimated ${estimatedRemainingTurns} turns remaining.`,
    })
  }

  // L3: Generate summary
  if (calculatedLevel >= 3 && enableLLMSummary && thread) {
    threadStore.setCompressionPhase('summarizing')
    try {
      const userTurns = thread.messages.filter(m => m.role === 'user').length
      const summaryResult = await generateSummary(thread.messages, { type: 'detailed' })
      threadStore.setContextSummary({
        objective: summaryResult.objective,
        completedSteps: summaryResult.completedSteps,
        pendingSteps: summaryResult.pendingSteps,
        decisions: [],
        fileChanges: summaryResult.fileChanges,
        errorsAndFixes: [],
        userInstructions: [],
        generatedAt: Date.now(),
        turnRange: [0, userTurns],
      })
      EventBus.emit({ type: 'context:summary', summary: summaryResult.summary })
    } catch {
      // Summary generation failed, not critical
    }
    threadStore.setCompressionPhase('idle')
  }

  // L4: Generate handoff
  if (calculatedLevel >= 4) {
    if (autoHandoff && thread && context.workspacePath) {
      threadStore.setCompressionPhase('summarizing')
      try {
        const handoff = await generateHandoffDocument(thread.id, thread.messages, context.workspacePath)
        store.setHandoffDocument(handoff)
        EventBus.emit({ type: 'context:handoff', document: handoff })
      } catch {
        // Handoff generation failed, not critical
      }
      threadStore.setCompressionPhase('idle')
    }

    const { language } = useStore.getState()
    threadStore.addSystemAlertPart(assistantId, {
      alertType: 'warning',
      title: getLocalizedText(language, '上下文已满', 'Context Limit Reached'),
      message: getLocalizedText(language, '当前对话已达到上下文限制，请开始新会话继续。', 'Please start a new session to continue.'),
    })
    threadStore.setHandoffRequired(true)
  }

  EventBus.emit({ type: 'context:level', level: calculatedLevel, tokens: newStats.inputTokens + newStats.outputTokens, ratio: newStats.ratio })

  return { level: calculatedLevel, needsHandoff: calculatedLevel >= 4 }
}

// ===== 主循环 =====

export async function runLoop(
  config: LLMConfig,
  llmMessages: LLMMessage[],
  context: ExecutionContext,
  assistantId: string,
  budgetController?: TokenBudgetController
): Promise<void> {
  const store = useAgentStore.getState()
  const mainStore = useStore.getState()

  // 创建线程绑定的 Store（确保后台任务不会影响其他线程）
  const threadId = context.threadId || store.currentThreadId
  if (!threadId) {
    logger.agent.error('[Loop] No thread ID available')
    return
  }
  const threadStore = store.forThread(threadId)

  // 一次性获取所有配置，避免重复调用 getState()
  const agentConfig = getAgentConfig()
  const maxIterations = mainStore.agentConfig.maxToolLoops || agentConfig.maxToolLoops
  const enableAutoFix = mainStore.agentConfig.enableAutoFix
  const enableLLMSummary = mainStore.agentConfig.enableLLMSummary
  const autoHandoff = mainStore.agentConfig.autoHandoff ?? agentConfig.autoHandoff

  // 获取模型上下文限制（默认 128k）
  const contextLimit = config.contextLimit || 128_000

  // 生成请求 ID，用于 IPC 频道隔离
  const requestId = context.requestId || crypto.randomUUID()
  threadStore.setExecutionMeta({
    requestId,
    assistantId,
    planTaskId: context.planTaskId,
    loopState: 'running',
  })
  threadStore.setStreamState({ requestId, assistantId })

  // 【性能关键】工具初始化只做一次，避免每个 LLM 调用轮次重复初始化
  initializeToolProviders()
  await initializeTools()
  setToolLoadingContext({
    mode: context.chatMode,
    templateId: useStore.getState().promptTemplateId,
    planPhase: context.chatMode === 'plan' ? context.planPhase : undefined,
  })
  const agentTools = context.chatMode === 'chat' ? [] : toolManager.getAllToolDefinitions()

  const loopDetector = new LoopDetector()
  let iteration = 0
  let shouldContinue = true

  const completeWithSoftLimitFeedback = async (
    title: string,
    detail: string,
    suggestion?: string,
    loopCheck?: LoopCheckResult
  ): Promise<void> => {
    const { language } = useStore.getState()
    const diagnosticText = formatLoopDiagnostic(language, loopCheck)

    llmMessages.push({
      role: 'user',
      content: [buildSoftLimitFeedback(language, title, detail, suggestion), diagnosticText]
        .filter(Boolean)
        .join('\n\n'),
    })

    const finalResult = await callLLMWithRetry(
      config,
      llmMessages,
      assistantId,
      threadStore,
      context.abortSignal,
      requestId,
      [],
      { allowToolCalls: false }
    )

    if (finalResult.error) {
      logger.agent.error('[Loop] Soft-limit recovery failed:', finalResult.error)
      threadStore.addSystemAlertPart(assistantId, {
        alertType: 'error',
        title: getLocalizedText(language, '模型错误', 'Model Error'),
        message: finalResult.error,
      })
      threadStore.updateExecutionMeta({ loopState: 'failed' })
      EventBus.emit({ type: 'loop:end', reason: 'error', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      return
    }

    threadStore.updateExecutionMeta({ loopState: 'completed' })
    EventBus.emit({ type: 'loop:end', reason: 'complete', threadId, assistantId, requestId, planTaskId: context.planTaskId })
  }

  const clearUnexecutedToolCards = (toolCallsToClear?: Array<{ id: string }>) => {
    if (!assistantId) {
      return
    }

    const assistantMessage = threadStore.getMessages().find(m => m.id === assistantId)
    if (assistantMessage?.role !== 'assistant') {
      return
    }

    const pendingIds = new Set((toolCallsToClear || []).map(tc => tc.id))
    threadStore.updateMessage(assistantId, {
      parts: assistantMessage.parts.filter(part =>
        part.type !== 'tool_call' || (
          !pendingIds.has(part.toolCall.id) &&
          !['pending', 'running', 'awaiting'].includes(part.toolCall.status)
        )
      ),
      toolCalls: (assistantMessage.toolCalls || []).filter(tc =>
        !pendingIds.has(tc.id) &&
        !['pending', 'running', 'awaiting'].includes(tc.status)
      ),
    })
  }

  EventBus.emit({ type: 'loop:start', threadId, assistantId, requestId, planTaskId: context.planTaskId })

  while (shouldContinue && iteration < maxIterations && !context.abortSignal?.aborted) {
    iteration++
    shouldContinue = false
    EventBus.emit({ type: 'loop:iteration', count: iteration, threadId, assistantId, requestId, planTaskId: context.planTaskId })

    // 检查中止信号
    if (context.abortSignal?.aborted) {
      EventBus.emit({ type: 'loop:end', reason: 'aborted', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    if (llmMessages.length === 0) {
      logger.agent.error('[Loop] No messages to send')
      const { language } = useStore.getState()
      threadStore.addSystemAlertPart(assistantId, {
        alertType: 'error',
        title: getLocalizedText(language, '请求异常', 'Request Error'),
        message: getLocalizedText(language, '当前没有可发送给模型的消息。', 'No messages were available to send to the model.'),
      })
      threadStore.updateExecutionMeta({ loopState: 'failed' })
      EventBus.emit({ type: 'loop:end', reason: 'no_messages', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    // 调用 LLM（传递预计算的 tools 和 requestId）
    const result = await callLLMWithRetry(config, llmMessages, assistantId, threadStore, context.abortSignal, requestId, agentTools)

    // 再次检查中止信号（LLM 调用后）
    if (context.abortSignal?.aborted) {
      EventBus.emit({ type: 'loop:end', reason: 'aborted', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    // 处理错误
    if (result.error) {
      const errorMsg = result.error.toLowerCase()
      const isToolParseError = errorMsg.includes('tool call parse') ||
        errorMsg.includes('invalid input for tool') ||
        errorMsg.includes('type validation failed')

      if (isToolParseError) {
        // 工具解析错误：作为用户消息返回给 AI，让它反思和重试
        logger.agent.warn('[Loop] Tool parse error, adding as feedback:', result.error)
        const { language } = useStore.getState()

        llmMessages.push({
          role: 'user',
          content: language === 'zh'
            ? `工具调用出错：${result.error}

请修正后重试，并确保：
1. 已提供所有必填参数
2. 参数类型正确
3. 参数名完全匹配

请基于修正后的工具调用继续。`
            : `Tool call error: ${result.error}

Please fix the tool call and try again. Make sure:
1. All required parameters are provided
2. Parameter types are correct
3. Parameter names match exactly

Try again with the corrected tool call.`
        })

        shouldContinue = true
        continue
      } else {
        // 其他错误：中止循环，并通过结构化卡片展示
        logger.agent.error('[Loop] LLM error:', result.error)
        const { language } = useStore.getState()
        threadStore.addSystemAlertPart(assistantId, {
          alertType: 'error',
          title: getLocalizedText(language, '模型错误', 'Model Error'),
          message: result.error,
        })
        threadStore.updateExecutionMeta({ loopState: 'failed' })
        EventBus.emit({ type: 'loop:end', reason: 'error', threadId, assistantId, requestId, planTaskId: context.planTaskId })
        break
      }
    }

    // 在 LLM 调用后立即检查压缩
    // 处理 usage 可能是数组或对象的情况
    const usageData = Array.isArray(result.usage) ? result.usage[0] : result.usage

    if (usageData && usageData.totalTokens > 0) {
      const usage = {
        input: usageData.promptTokens || 0,
        output: usageData.completionTokens || 0,
      }

      const compressionResult = await checkAndHandleCompression(
        usage,
        contextLimit,
        store,
        threadStore,
        context,
        assistantId,
        enableLLMSummary,
        autoHandoff,
        budgetController
      )

      // L4 需要中断循环
      if (compressionResult.needsHandoff) {
        threadStore.updateExecutionMeta({ loopState: 'completed' })
        EventBus.emit({ type: 'loop:end', reason: 'handoff_required', threadId, assistantId, requestId, planTaskId: context.planTaskId })
        break
      }
    } else {
      // 兜底：使用精确估算值更新统计
      logger.agent.warn('[Loop] No valid usage data from LLM, using estimated tokens')

      const estimatedTokens = estimateMessagesTokens(llmMessages as ChatMessage[])

      // 假设 90% 是输入，10% 是输出（保守估计）
      const usage = {
        input: Math.floor(estimatedTokens * 0.9),
        output: Math.floor(estimatedTokens * 0.1),
      }

      // 更新消息的 usage（使用估算值）
      if (assistantId) {
        store.updateMessage(assistantId, {
          usage: {
            promptTokens: usage.input,
            completionTokens: usage.output,
            totalTokens: usage.input + usage.output,
          }
        } as Partial<import('../types').AssistantMessage>)
      }

      const compressionResult = await checkAndHandleCompression(
        usage,
        contextLimit,
        store,
        threadStore,
        context,
        assistantId,
        enableLLMSummary,
        autoHandoff,
        budgetController
      )

      // L4 需要中断循环
      if (compressionResult.needsHandoff) {
        threadStore.updateExecutionMeta({ loopState: 'completed' })
        EventBus.emit({ type: 'loop:end', reason: 'handoff_required', threadId, assistantId, requestId, planTaskId: context.planTaskId })
        break
      }
    }

    // 没有工具调用 - Chat 模式或 LLM 决定结束
    if (!result.toolCalls || result.toolCalls.length === 0) {
      // 模式后处理钩子
      const hookResult = executeModePostProcessHook(context.chatMode, {
        mode: context.chatMode,
        messages: llmMessages,
        hasWriteOps: llmMessages.some(m => {
          const readOnlyTools = getReadOnlyTools()
          return m.role === 'assistant' && m.tool_calls?.some((tc: any) => !readOnlyTools.includes(tc.function.name))
        }),
        hasSpecificTool: (toolName: string) => llmMessages.some(m =>
          m.role === 'assistant' && m.tool_calls?.some((tc: any) => tc.function.name === toolName)
        ),
        iteration,
        maxIterations,
      })

      if (hookResult?.shouldContinue && hookResult.reminderMessage) {
        llmMessages.push({ role: 'user', content: hookResult.reminderMessage })
        shouldContinue = true
        continue
      }
      threadStore.updateExecutionMeta({ loopState: 'completed' })
      EventBus.emit({ type: 'loop:end', reason: 'complete', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    // 循环检测
    const loopCheck = loopDetector.checkLoop(result.toolCalls)
    if (loopCheck.isLoop) {
      logger.agent.warn(`[Loop] Loop detected: ${loopCheck.reason}`)
      const { language } = useStore.getState()
      const loopTitle = getLocalizedText(language, '检测到循环执行', 'Loop Detected')
      const loopMessage = getLoopCheckMessage(language, loopCheck)
      const loopSuggestion = getLoopCheckSuggestion(language, loopCheck)
      clearUnexecutedToolCards(result.toolCalls)
      threadStore.addSystemAlertPart(assistantId, {
        alertType: 'warning',
        title: loopTitle,
        message: loopMessage,
        suggestion: loopSuggestion,
        compact: true,
      })
      EventBus.emit({ type: 'loop:warning', message: loopMessage, threadId, assistantId, requestId, planTaskId: context.planTaskId })
      await completeWithSoftLimitFeedback(loopTitle, loopMessage, loopSuggestion, loopCheck)
      break
    }

    // 非阻断型循环预警也走结构化告警卡片，避免退化成普通文本。
    if (loopCheck.warning) {
      const { language } = useStore.getState()
      const warningTitle = getLocalizedText(language, '循环预警', 'Loop Warning')
      const warningMessage = getLoopCheckMessage(language, loopCheck)
      const warningSuggestion = getLoopCheckSuggestion(language, loopCheck)
      logger.agent.warn(`[Loop] Non-blocking loop warning: ${loopCheck.warning}`)
      clearUnexecutedToolCards(result.toolCalls)
      threadStore.addSystemAlertPart(assistantId, {
        alertType: 'warning',
        title: warningTitle,
        message: warningMessage,
        suggestion: warningSuggestion,
        compact: true,
      })
      EventBus.emit({ type: 'loop:warning', message: warningMessage, threadId, assistantId, requestId, planTaskId: context.planTaskId })

      llmMessages.push({
        role: 'user',
        content: [
          buildSoftLimitFeedback(language, warningTitle, warningMessage, warningSuggestion),
          formatLoopDiagnostic(language, loopCheck),
        ].filter(Boolean).join('\n\n'),
      })

      shouldContinue = true
      continue
    }

    // 添加到消息历史
    llmMessages.push({
      role: 'assistant',
      content: result.content || null,
      tool_calls: result.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    })

    // 执行工具
    const { results: toolResults, userRejected } = await executeTools(
      result.toolCalls,
      {
        workspacePath: context.workspacePath,
        currentAssistantId: assistantId,
        assistantId,
        threadId,
        requestId,
        chatMode: context.chatMode,
        checkpointId: context.checkpointId,
      },
      threadStore,
      context.abortSignal
    )

    // 检查中止信号（工具执行后）
    if (context.abortSignal?.aborted) {
      EventBus.emit({ type: 'loop:end', reason: 'aborted', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    // 检查 ask_user
    const waitingResult = toolResults.find(r => r.result.meta?.waitingForUser)
    if (waitingResult) {
      // 从 meta 中提取 interactive 数据并设置到 store
      const interactive = waitingResult.result.meta?.interactive as import('../types').InteractiveContent | undefined
      if (interactive) {
        threadStore.setInteractive(assistantId, interactive)
      } else {
        // 兜底：如果没有 interactive 数据，至少要 finalize
        threadStore.finalizeAssistant(assistantId)
      }
      threadStore.setStreamPhase('idle')
      threadStore.updateExecutionMeta({ loopState: 'waiting_for_user' })
      EventBus.emit({ type: 'loop:end', reason: 'waiting_for_user', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    // 检查 stopLoop (create_task_plan 等工具请求停止循环)
    const stopLoopResult = toolResults.find(r => r.result.meta?.stopLoop)
    if (stopLoopResult) {
      threadStore.finalizeAssistant(assistantId)
      threadStore.setStreamPhase('idle')
      threadStore.updateExecutionMeta({ loopState: 'completed' })
      EventBus.emit({ type: 'loop:end', reason: 'tool_requested_stop', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    // 添加工具结果
    for (const { toolCall, result: toolResult } of toolResults) {
      llmMessages.push({
        role: 'tool' as const,
        tool_call_id: toolCall.id,
        name: toolCall.name,
        content: toolResult.content,
      })

      // 只把真实执行过的工具记入循环历史，避免“工具意图”和“真实执行”混淆。
      const success = !toolResult.content.startsWith('Error:')
      loopDetector.recordExecutedTool({
        name: toolCall.name,
        arguments: toolCall.arguments,
      }, success)

      const meta = toolResult.meta
      if (meta?.filePath && typeof meta.filePath === 'string' && typeof meta.newContent === 'string') {
        loopDetector.updateContentHash(meta.filePath, meta.newContent)

        // 添加待确认的文件变更
        store.addPendingChange({
          filePath: meta.filePath,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          changeType: meta.oldContent ? 'modify' : 'create',
          snapshot: {
            path: meta.filePath,
            content: (meta.oldContent as string) || null,
            timestamp: Date.now(),
          },
          newContent: meta.newContent,
          linesAdded: (meta.linesAdded as number) || 0,
          linesRemoved: (meta.linesRemoved as number) || 0,
        })
      }
    }

    // 自动修复：检查 lint 错误，若有则注入到 llmMessages 让 AI 可以看到并修复
    if (enableAutoFix && !userRejected && context.workspacePath) {
      const autoFixResult = await autoFix(result.toolCalls, context.workspacePath)
      if (autoFixResult) {
        // 添加结构化的 lint check part（UI 展示用）
        threadStore.addLintCheckPart(assistantId)
        threadStore.updateLintCheckPart(assistantId, {
          files: autoFixResult.files,
          status: 'failed',
        })
        // 注入文本给 LLM
        llmMessages.push({ role: 'user', content: autoFixResult.content })
        // 强制继续循环让 AI 看到错误并修复
        shouldContinue = true
        threadStore.setStreamPhase('streaming')
        continue
      }
    }

    if (userRejected) {
      threadStore.updateExecutionMeta({ loopState: 'aborted' })
      EventBus.emit({ type: 'loop:end', reason: 'user_rejected', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    shouldContinue = true
    threadStore.setStreamPhase('streaming')
  }

  // 达到最大迭代次数
  if (iteration >= maxIterations) {
    logger.agent.warn('[Loop] Reached maximum iterations')
    const { language } = useStore.getState()
    const limitTitle = getLocalizedText(language, '达到工具调用上限', 'Tool Call Limit Reached')
    const limitMessage = getLocalizedText(language, '当前轮次已达到最大工具调用次数。', 'The agent reached the maximum tool call limit for this turn.')
    threadStore.addSystemAlertPart(assistantId, {
      alertType: 'warning',
      title: limitTitle,
      message: limitMessage,
      compact: true,
    })
    EventBus.emit({ type: 'loop:warning', message: 'Max iterations reached', threadId, assistantId, requestId, planTaskId: context.planTaskId })
    await completeWithSoftLimitFeedback(
      limitTitle,
      limitMessage,
      getLocalizedText(language, '请停止继续调工具，直接总结当前进展并调整策略。', 'Stop calling tools, summarize the current progress, and adjust the strategy.'),
    )
  }
}
