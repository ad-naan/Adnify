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
import { estimateMessagesTokens } from '../domains/context/CompressionManager'
import { lintService } from '../services/lintService'
import { getRelativeChangePath, isFileWriteToolResult } from '../utils/fileChangeUtils'
import type { TokenBudgetController } from '../domains/budget/TokenBudgetController'
import type { LintCheckFile, ChatMessage, AssistantMessage, InteractiveContent } from '../types'
import type { LLMMessage } from '@/shared/types'
import type { WorkMode } from '@/renderer/modes/types'
import type { LLMConfig, LLMCallResult, ExecutionContext, LoopCheckResult } from './types'
import { pickLocalizedText, translateAgentText } from '../utils/agentText'
import { checkAndHandleCompression as runCompressionCheck } from './contextCompression'

function getLocalizedText(language: string, zh: string, en: string): string {
  return pickLocalizedText(zh, en, language as 'en' | 'zh')
}

function translate(language: string, key: Parameters<typeof translateAgentText>[0], params?: Record<string, string | number>): string {
  return translateAgentText(key, params, language as 'en' | 'zh')
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

function buildSoftLimitFeedback(language: string, title: string, detail: string, suggestion?: string): string {
  if (language === 'zh') {
    return [
      `系统警告: ${title}`,
      detail,
      suggestion ? `建议: ${suggestion}` : '',
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
  if (!details) return ''

  const lines: string[] = []
  if (language === 'zh') {
    lines.push('诊断信息:')
    lines.push(`- 类型: ${details.category}`)
    if (details.toolName) lines.push(`- 工具: ${details.toolName}`)
    if (typeof details.count === 'number') lines.push(`- 次数: ${details.count}`)
    if (typeof details.threshold === 'number') lines.push(`- 阈值: ${details.threshold}`)
    if (details.target) lines.push(`- 目标: ${details.target}`)
    if (details.pattern) lines.push(`- 模式: ${details.pattern}`)
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

async function callLLM(
  config: LLMConfig,
  messages: LLMMessage[],
  assistantId: string | null,
  threadStore: import('../store/AgentStore').ThreadBoundStore,
  requestId: string,
  tools: import('@/shared/types/llm').ToolDefinition[],
  options?: { allowToolCalls?: boolean }
): Promise<LLMCallResult> {
  performanceMonitor.start(`llm:${config.model}`, 'llm', { provider: config.provider, messageCount: messages.length })
  const processor = createStreamProcessor(assistantId, threadStore, requestId, options)

  try {
    await api.llm.send({
      config: config as import('@shared/types/llm').LLMConfig,
      messages: messages as LLMMessage[],
      tools,
      systemPrompt: '',
      requestId,
    })

    const result = await processor.wait()
    performanceMonitor.end(`llm:${config.model}`, !result.error)

    if (assistantId && result.usage) {
      useAgentStore.getState().updateMessage(assistantId, {
        usage: result.usage,
      } as Partial<AssistantMessage>)
    } else if (assistantId && !result.usage) {
      logger.agent.warn('[Loop] No usage data in LLM result')
    }

    if (assistantId && result.reasoning) {
      useAgentStore.getState().updateMessage(assistantId, {
        reasoning: result.reasoning,
      } as Partial<AssistantMessage>)
    }

    processor.cleanup()
    return result
  } catch (error) {
    processor.cleanup()
    logger.agent.error('[Loop] Error in callLLM:', error)
    return { error: error instanceof Error ? error.message : String(error) }
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
  options?: { allowToolCalls?: boolean }
): Promise<LLMCallResult> {
  const retryConfig = getAgentConfig()
  const reqId = requestId || crypto.randomUUID()

  try {
    return await withRetry(
      async () => {
        if (abortSignal?.aborted) throw new Error('Aborted')

        let snapshot: { content: string; parts: any[]; toolCalls: any[] } | null = null
        if (assistantId) {
          const msg = threadStore.getMessages().find(m => m.id === assistantId)
          if (msg?.role === 'assistant') {
            snapshot = {
              content: msg.content,
              parts: [...(msg.parts || [])],
              toolCalls: [...(msg.toolCalls || [])],
            }
          }
        }

        try {
          const result = await callLLM(config, messages, assistantId, threadStore, reqId, tools, options)
          if (result.error) {
            const errorMsg = result.error.toLowerCase()
            const isToolParseError = errorMsg.includes('tool call parse')
              || errorMsg.includes('invalid input for tool')
              || errorMsg.includes('type validation failed')

            if (isToolParseError) {
              logger.agent.warn('[Loop] Tool parse error, will be handled in loop:', result.error)
              return result
            }

            throw new Error(result.error)
          }

          return result
        } catch (err) {
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
        onRetry: (attempt, error, delay) => {
          logger.agent.info(`[Loop] LLM retry ${attempt}, waiting ${delay}ms...`, error)
        },
      }
    )
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

interface AutoFixResult {
  content: string
  files: LintCheckFile[]
}

async function autoFix(toolCalls: any[], workspacePath: string): Promise<AutoFixResult | null> {
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
      errors: errorItems.map(e => ({
        severity: e.severity as 'error' | 'warning',
        message: e.message,
        line: e.startLine ?? 1,
      })),
    })
  }

  const filesWithErrors = allFiles.filter(f => f.errors.length > 0)
  if (filesWithErrors.length === 0) return null

  const lines = filesWithErrors.map(f => {
    const errLines = f.errors.map(e => `  [${e.severity}] Line ${e.line}: ${e.message}`).join('\n')
    return `File: ${f.filePath}\n${errLines}`
  })

  return {
    content: `Auto-check detected lint errors in ${filesWithErrors.length} file(s). Please fix them:\n\n${lines.join('\n\n')}`,
    files: allFiles,
  }
}

export async function runLoop(
  config: LLMConfig,
  llmMessages: LLMMessage[],
  context: ExecutionContext,
  assistantId: string,
  budgetController?: TokenBudgetController
): Promise<void> {
  const store = useAgentStore.getState()
  const mainStore = useStore.getState()

  const threadId = context.threadId || store.currentThreadId
  if (!threadId) {
    logger.agent.error('[Loop] No thread ID available')
    return
  }

  const threadStore = store.forThread(threadId)
  const agentConfig = getAgentConfig()
  const maxIterations = mainStore.agentConfig.maxToolLoops || agentConfig.maxToolLoops
  const enableAutoFix = mainStore.agentConfig.enableAutoFix
  const enableLLMSummary = mainStore.agentConfig.enableLLMSummary
  const autoHandoff = mainStore.agentConfig.autoHandoff ?? agentConfig.autoHandoff
  const contextLimit = config.contextLimit || 128_000
  const requestId = context.requestId || crypto.randomUUID()

  threadStore.setExecutionMeta({
    requestId,
    assistantId,
    planTaskId: context.planTaskId,
    loopState: 'running',
  })
  threadStore.setStreamState({ requestId, assistantId })

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
    if (!assistantId) return

    const assistantMessage = threadStore.getMessages().find(m => m.id === assistantId)
    if (assistantMessage?.role !== 'assistant') return

    const pendingIds = new Set((toolCallsToClear || []).map(tc => tc.id))
    threadStore.updateMessage(assistantId, {
      parts: assistantMessage.parts.filter(part =>
        part.type !== 'tool_call'
        || (!pendingIds.has(part.toolCall.id) && !['pending', 'running', 'awaiting'].includes(part.toolCall.status))
      ),
      toolCalls: (assistantMessage.toolCalls || []).filter(tc =>
        !pendingIds.has(tc.id) && !['pending', 'running', 'awaiting'].includes(tc.status)
      ),
    })
  }

  EventBus.emit({ type: 'loop:start', threadId, assistantId, requestId, planTaskId: context.planTaskId })

  while (shouldContinue && iteration < maxIterations && !context.abortSignal?.aborted) {
    iteration++
    shouldContinue = false
    EventBus.emit({ type: 'loop:iteration', count: iteration, threadId, assistantId, requestId, planTaskId: context.planTaskId })

    if (context.abortSignal?.aborted) {
      EventBus.emit({ type: 'loop:end', reason: 'aborted', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    if (llmMessages.length === 0) {
      const { language } = useStore.getState()
      logger.agent.error('[Loop] No messages to send')
      threadStore.addSystemAlertPart(assistantId, {
        alertType: 'error',
        title: getLocalizedText(language, '请求异常', 'Request Error'),
        message: getLocalizedText(language, '当前没有可发送给模型的消息。', 'No messages were available to send to the model.'),
      })
      threadStore.updateExecutionMeta({ loopState: 'failed' })
      EventBus.emit({ type: 'loop:end', reason: 'no_messages', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    const result = await callLLMWithRetry(
      config,
      llmMessages,
      assistantId,
      threadStore,
      context.abortSignal,
      requestId,
      agentTools
    )

    if (context.abortSignal?.aborted) {
      EventBus.emit({ type: 'loop:end', reason: 'aborted', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    if (result.error) {
      const errorMsg = result.error.toLowerCase()
      const isToolParseError = errorMsg.includes('tool call parse')
        || errorMsg.includes('invalid input for tool')
        || errorMsg.includes('type validation failed')

      if (isToolParseError) {
        const { language } = useStore.getState()
        logger.agent.warn('[Loop] Tool parse error, adding as feedback:', result.error)

        llmMessages.push({
          role: 'user',
          content: language === 'zh'
            ? `工具调用出错: ${result.error}

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

Try again with the corrected tool call.`,
        })

        shouldContinue = true
        continue
      }

      const { language } = useStore.getState()
      logger.agent.error('[Loop] LLM error:', result.error)
      threadStore.addSystemAlertPart(assistantId, {
        alertType: 'error',
        title: getLocalizedText(language, '模型错误', 'Model Error'),
        message: result.error,
      })
      threadStore.updateExecutionMeta({ loopState: 'failed' })
      EventBus.emit({ type: 'loop:end', reason: 'error', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    const usageData = Array.isArray(result.usage) ? result.usage[0] : result.usage

    if (usageData && usageData.totalTokens > 0) {
      const usage = {
        input: usageData.promptTokens || 0,
        output: usageData.completionTokens || 0,
      }

      const compressionResult = await runCompressionCheck(
        usage,
        contextLimit,
        threadStore,
        threadId,
        context,
        assistantId,
        enableLLMSummary,
        autoHandoff,
        budgetController
      )

      if (compressionResult.needsHandoff) {
        threadStore.updateExecutionMeta({ loopState: 'completed' })
        EventBus.emit({ type: 'loop:end', reason: 'handoff_required', threadId, assistantId, requestId, planTaskId: context.planTaskId })
        break
      }
    } else {
      logger.agent.warn('[Loop] No valid usage data from LLM, using estimated tokens')

      const estimatedTokens = estimateMessagesTokens(llmMessages as ChatMessage[])
      const usage = {
        input: Math.floor(estimatedTokens * 0.9),
        output: Math.floor(estimatedTokens * 0.1),
      }

      if (assistantId) {
        store.updateMessage(assistantId, {
          usage: {
            promptTokens: usage.input,
            completionTokens: usage.output,
            totalTokens: usage.input + usage.output,
          },
        } as Partial<AssistantMessage>)
      }

      const compressionResult = await runCompressionCheck(
        usage,
        contextLimit,
        threadStore,
        threadId,
        context,
        assistantId,
        enableLLMSummary,
        autoHandoff,
        budgetController
      )

      if (compressionResult.needsHandoff) {
        threadStore.updateExecutionMeta({ loopState: 'completed' })
        EventBus.emit({ type: 'loop:end', reason: 'handoff_required', threadId, assistantId, requestId, planTaskId: context.planTaskId })
        break
      }
    }

    if (!result.toolCalls || result.toolCalls.length === 0) {
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

    const loopCheck = loopDetector.checkLoop(result.toolCalls)
    if (loopCheck.isLoop) {
      const { language } = useStore.getState()
      const loopTitle = getLocalizedText(language, '检测到循环执行', 'Loop Detected')
      const loopMessage = getLoopCheckMessage(language, loopCheck)
      const loopSuggestion = getLoopCheckSuggestion(language, loopCheck)

      logger.agent.warn(`[Loop] Loop detected: ${loopCheck.reason}`)
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

    llmMessages.push({
      role: 'assistant',
      content: result.content || null,
      reasoning_content: result.reasoning,
      tool_calls: result.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    })

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

    if (context.abortSignal?.aborted) {
      EventBus.emit({ type: 'loop:end', reason: 'aborted', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    const waitingResult = toolResults.find(r => r.result.meta?.waitingForUser)
    if (waitingResult) {
      const interactive = waitingResult.result.meta?.interactive as InteractiveContent | undefined
      if (interactive) {
        threadStore.setInteractive(assistantId, interactive)
      } else {
        threadStore.finalizeAssistant(assistantId)
      }

      threadStore.setStreamPhase('idle')
      threadStore.updateExecutionMeta({ loopState: 'waiting_for_user' })
      EventBus.emit({ type: 'loop:end', reason: 'waiting_for_user', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    const stopLoopResult = toolResults.find(r => r.result.meta?.stopLoop)
    if (stopLoopResult) {
      threadStore.finalizeAssistant(assistantId)
      threadStore.setStreamPhase('idle')
      threadStore.updateExecutionMeta({ loopState: 'completed' })
      EventBus.emit({ type: 'loop:end', reason: 'tool_requested_stop', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    for (const { toolCall, result: toolResult } of toolResults) {
      llmMessages.push({
        role: 'tool' as const,
        tool_call_id: toolCall.id,
        name: toolCall.name,
        content: toolResult.content,
      })

      const success = !toolResult.content.startsWith('Error:')
      loopDetector.recordExecutedTool({
        name: toolCall.name,
        arguments: toolCall.arguments,
      }, success)

      const meta = toolResult.meta
      if (isFileWriteToolResult(toolCall.name, meta)) {
        if (typeof meta.postHash === 'string') {
          loopDetector.updateContentHashBySignature(meta.filePath, meta.postHash)
        } else if (typeof meta.newContent === 'string') {
          loopDetector.updateContentHash(meta.filePath, meta.newContent)
        }

        const relativePath = getRelativeChangePath(meta.filePath, context.workspacePath ?? null, meta.relativePath)

        store.addPendingChange({
          filePath: meta.filePath,
          relativePath,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          changeType: meta.oldContent ? 'modify' : 'create',
          snapshot: {
            path: meta.filePath,
            content: (meta.oldContent as string) || null,
            timestamp: Date.now(),
          },
          newContent: typeof meta.newContent === 'string' ? meta.newContent : null,
          linesAdded: (meta.linesAdded as number) || 0,
          linesRemoved: (meta.linesRemoved as number) || 0,
        })
      }
    }

    if (enableAutoFix && !userRejected && context.workspacePath) {
      const autoFixResult = await autoFix(result.toolCalls, context.workspacePath)
      if (autoFixResult) {
        threadStore.addLintCheckPart(assistantId)
        threadStore.updateLintCheckPart(assistantId, {
          files: autoFixResult.files,
          status: 'failed',
        })
        llmMessages.push({ role: 'user', content: autoFixResult.content })
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

  if (iteration >= maxIterations) {
    const { language } = useStore.getState()
    const limitTitle = getLocalizedText(language, '达到工具调用上限', 'Tool Call Limit Reached')
    const limitMessage = getLocalizedText(language, '当前轮次已达到最大工具调用次数。', 'The agent reached the maximum tool call limit for this turn.')

    logger.agent.warn('[Loop] Reached maximum iterations')
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
      getLocalizedText(language, '请停止继续调工具，直接总结当前进展并调整策略。', 'Stop calling tools, summarize the current progress, and adjust the strategy.')
    )
  }
}
