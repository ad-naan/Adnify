import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { performanceMonitor, withRetry, isRetryableError } from '@shared/utils'
import { useAgentStore } from '../store/AgentStore'
import { useStore } from '@store'
import { getAgentConfig, READ_TOOLS } from '../utils/AgentConfig'
import { LoopDetector } from '../utils/LoopDetector'
import { isInternalToolRoutingCategory, ToolRoutingAdvisor } from '../utils/ToolRoutingAdvisor'
import { getReadOnlyTools, isFileEditTool } from '@/shared/config/tools'
import { pathStartsWith, joinPath } from '@shared/utils/pathUtils'
import { createStreamProcessor } from './stream'
import { EventBus } from './EventBus'
import { estimateMessagesTokens } from '../domains/context/CompressionManager'
import { recordObservedTokenUsage } from '@shared/utils/tokenCounter'
import { getRelativeChangePath, isFileWriteToolResult } from '../utils/fileChangeUtils'
import type { TokenBudgetController } from '../domains/budget/TokenBudgetController'
import type { LintCheckFile, ChatMessage, AssistantMessage, InteractiveContent } from '../types'
import type { WorkMode } from '@/renderer/modes/types'
import type { LLMConfig, LLMCallResult, ExecutionContext, LoopCheckResult } from './types'
import {
  messageContentHasImages,
  resolveMessageRouting,
  resolveRuntimeModelRoutingConfig,
} from '@shared/config/modelRouting'
import { pickLocalizedText, translateAgentText } from '../utils/agentText'
import { checkAndHandleCompression as runCompressionCheck } from './contextCompression'
import {
  injectVisualSummaryIntoMessages,
  runMultimodalPrepass,
  stripImagesFromAllUserMessages,
  stripImagesFromLatestUserMessage,
} from '../services/multimodalRoutingService'
import { aiAttributionService } from '@/renderer/services/aiAttributionService'
import { derivePlanPlanningState, getPlanContinuationReminder, selectPlanPlanningTools } from '../plan/planWorkflowGuard'
import { completeTodosAfterSuccessfulTurn } from '../utils/todoCompletion'
import type { ThreadBoundStore } from '../store/AgentStore'
import { clearUnexecutedToolCards, prepareLLMRequestMessages } from './loopMessageUtils'

export { clearUnexecutedToolCards, prepareLLMRequestMessages } from './loopMessageUtils'

const importToolRuntime = () => import('../tools')
const importExecuteTools = () => import('./tools').then(m => m.executeTools)
const importLintService = () => import('../services/lintService').then(m => m.lintService)

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
    case 'semantic_navigation':
      return translate(language, details.pattern === 'fallback_source_read_burst'
        ? 'agent.routing.fallbackReadBurst'
        : 'agent.routing.sourceReadBurst')
    case 'tool_routing':
      return translate(language, details.pattern === 'shell_file_discovery'
        ? 'agent.routing.shellDiscovery'
        : 'agent.routing.recursiveDirectory')
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
    case 'semantic_navigation':
      return translate(language, details.pattern === 'fallback_source_read_burst'
        ? 'agent.routing.suggestion.fallbackReadBurst'
        : 'agent.routing.suggestion.sourceReadBurst')
    case 'tool_routing':
      return translate(language, details.pattern === 'shell_file_discovery'
        ? 'agent.routing.suggestion.shellDiscovery'
        : 'agent.routing.suggestion.recursiveDirectory')
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

function buildToolRoutingFeedback(language: string, detail: string, suggestion?: string): string {
  return [
    translate(language, 'agent.routing.feedback.intro'),
    detail,
    suggestion ? translate(language, 'agent.routing.feedback.suggestion', { suggestion }) : '',
    translate(language, 'agent.routing.feedback.continue'),
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
  systemPrompt: string | undefined,
  assistantId: string | null,
  threadStore: import('../store/AgentStore').ThreadBoundStore,
  requestId: string,
  tools: import('@/shared/types/llm').ToolDefinition[],
  options?: { allowToolCalls?: boolean }
): Promise<LLMCallResult> {
  performanceMonitor.start(`llm:${config.model}`, 'llm', { provider: config.provider, messageCount: messages.length })
  const startedAt = Date.now()
  const processor = createStreamProcessor(assistantId, threadStore, requestId, options)

  try {
    const requestMessages = prepareLLMRequestMessages(messages, systemPrompt)

    await api.llm.send({
      config: config as import('@shared/types/llm').LLMConfig,
      messages: requestMessages as LLMMessage[],
      tools,
      systemPrompt,
      requestId,
    })

    const result = await processor.wait()
    performanceMonitor.end(`llm:${config.model}`, !result.error)

    if (assistantId && result.usage) {
      const responseMeta = {
        provider: config.provider,
        modelId: result.metadata?.modelId || config.model,
        requestId,
        durationMs: Date.now() - startedAt,
        timestamp: Date.now(),
      }
      useAgentStore.getState().updateMessage(assistantId, {
        usage: result.usage,
        responseMeta,
      } as Partial<AssistantMessage>)

      void aiAttributionService.attachAssistantResponseMeta({
        threadId: useAgentStore.getState().currentThreadId,
        assistantId,
        provider: responseMeta.provider,
        modelId: responseMeta.modelId,
        requestId: responseMeta.requestId,
      })
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
  systemPrompt: string | undefined,
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
          const result = await callLLM(config, messages, systemPrompt, assistantId, threadStore, reqId, tools, options)
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
  const lintService = await importLintService()
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
  const completeVisibleTodos = () => {
    const todos = threadStore.getTodos()
    if (todos.some(todo => todo.status !== 'completed')) {
      threadStore.setTodos(completeTodosAfterSuccessfulTurn(todos))
    }
  }
  const agentConfig = getAgentConfig()
  const maxIterations = mainStore.agentConfig.maxToolLoops || agentConfig.maxToolLoops
  const enableAutoFix = mainStore.agentConfig.enableAutoFix
  const enableLLMSummary = mainStore.agentConfig.enableLLMSummary
  const autoHandoff = mainStore.agentConfig.autoHandoff ?? agentConfig.autoHandoff
  const requestId = context.requestId || crypto.randomUUID()
  const routingConfig = resolveRuntimeModelRoutingConfig(mainStore.modelRouting, config)

  threadStore.setExecutionMeta({
    requestId,
    assistantId,
    planTaskId: context.planTaskId,
    loopState: 'running',
  })
  threadStore.setStreamState({ requestId, assistantId })

  const toolRuntime = await importToolRuntime()
  await toolRuntime.initializeTools()
  toolRuntime.initializeToolProviders()
  toolRuntime.setToolLoadingContext({
    mode: context.chatMode,
    templateId: useStore.getState().promptTemplateId,
    planPhase: context.chatMode === 'plan' ? context.planPhase : undefined,
    isSubAgent: context.isSubAgent,
  })

  const agentTools = toolRuntime.toolManager.getAllToolDefinitions()
  const executeTools = await importExecuteTools()
  const loopDetector = new LoopDetector()
  const toolRoutingAdvisor = new ToolRoutingAdvisor()
  let requestMessages = llmMessages
  let iteration = 0
  let shouldContinue = true

  // Auto-fix feeds lint errors back to the model and spends an iteration doing
  // so. Errors the model cannot fix (generated files, vendored code, false
  // positives) would otherwise consume every remaining iteration and push the
  // turn into the tool-call limit. Stop re-reporting an identical error set after
  // a couple of attempts and let the model get on with the task instead.
  const AUTO_FIX_MAX_ATTEMPTS_PER_SIGNATURE = 2
  const autoFixAttempts = new Map<string, number>()

  const messageRouting = resolveMessageRouting(
    requestMessages,
    routingConfig,
    mainStore.providerConfigs,
    config,
  )
  const primaryConfig = messageRouting.primaryConfig
  const contextLimit = config.contextLimit || 128_000

  if (messageRouting.shouldUseMultimodalPrepass && messageRouting.multimodalConfig) {
    const targetUserMessage = [...requestMessages].reverse().find(message => message.role === 'user')

    if (targetUserMessage) {
      try {
        const prepassResult = await runMultimodalPrepass({
          config: messageRouting.multimodalConfig,
          userMessage: targetUserMessage,
          requestId: `${requestId}-multimodal`,
          abortSignal: context.abortSignal,
        })
        requestMessages = injectVisualSummaryIntoMessages(requestMessages, prepassResult.summary)
      } catch (error) {
        // On prepass failure, strip images only if the abort was not triggered.
        // The primary model will attempt to handle the text-only version.
        if (!context.abortSignal?.aborted) {
          requestMessages = stripImagesFromLatestUserMessage(requestMessages)
          const { language } = useStore.getState()
          const reason = error instanceof Error && error.message ? ` ${error.message}` : ''
          threadStore.addSystemAlertPart(assistantId, {
            alertType: 'warning',
            title: getLocalizedText(language, '多模态回退', 'Multimodal Fallback'),
            message: getLocalizedText(
              language,
              `多模态模型调用失败，已回退到主模型继续处理。${reason}`,
              `The multimodal model failed, so Adnify fell back to the primary model.${reason}`,
            ),
            compact: true,
          })
        }
      }
    }
  }

  const completeWithSoftLimitFeedback = async (
    title: string,
    detail: string,
    suggestion?: string,
    loopCheck?: LoopCheckResult
  ): Promise<void> => {
    // The soft-limit recovery issues a fresh LLM request. If the user has
    // already aborted, that request must not go out: emit the abort terminal
    // event instead so callers awaiting `loop:end` still settle.
    if (context.abortSignal?.aborted) {
      threadStore.updateExecutionMeta({ loopState: 'aborted' })
      EventBus.emit({ type: 'loop:end', reason: 'aborted', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      return
    }

    const { language } = useStore.getState()
    const diagnosticText = formatLoopDiagnostic(language, loopCheck)

    requestMessages.push({
      role: 'user',
      content: [buildSoftLimitFeedback(language, title, detail, suggestion), diagnosticText]
        .filter(Boolean)
        .join('\n\n'),
    })

    const finalResult = await callLLMWithRetry(
      primaryConfig,
      requestMessages,
      context.systemPrompt,
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
    completeVisibleTodos()
    EventBus.emit({ type: 'loop:end', reason: 'complete', threadId, assistantId, requestId, planTaskId: context.planTaskId })
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

    if (requestMessages.length === 0) {
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

    const planningState = context.chatMode === 'plan' && context.planPhase !== 'executing'
      ? derivePlanPlanningState(requestMessages)
      : null
    const iterationTools = planningState
      ? selectPlanPlanningTools(planningState, agentTools)
      : agentTools

    let result = await callLLMWithRetry(
      primaryConfig,
      requestMessages,
      context.systemPrompt,
      assistantId,
      threadStore,
      context.abortSignal,
      requestId,
      iterationTools
    )

    const requestContainedImages = requestMessages.some(message => messageContentHasImages(message.content))
    if (result.error && requestContainedImages && !context.abortSignal?.aborted) {
      const initialImageError = result.error
      requestMessages = stripImagesFromAllUserMessages(requestMessages)
      const { language } = useStore.getState()

      logger.agent.warn('[Loop] Image request failed; retrying once with text-only messages:', initialImageError)
      threadStore.addSystemAlertPart(assistantId, {
        alertType: 'warning',
        title: getLocalizedText(language, '图片输入已降级', 'Image Input Fallback'),
        message: getLocalizedText(
          language,
          '当前端点未能处理这次图片请求，已自动移除图片并继续文本处理。',
          'The endpoint could not process this image request. Adnify removed the images and continued with text-only input.',
        ),
        compact: true,
      })

      result = await callLLMWithRetry(
        primaryConfig,
        requestMessages,
        context.systemPrompt,
        assistantId,
        threadStore,
        context.abortSignal,
        `${requestId}-text-fallback`,
        iterationTools,
      )
    }

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

        requestMessages.push({
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

      // Calibrate the estimator against ground truth. cl100k_base is OpenAI's
      // tokenizer; for every other provider our estimate is off by an unknown
      // factor, and the model list cannot be enumerated (custom providers, local
      // models, aggregator gateways). Comparing our estimate for this request
      // against the prompt tokens the provider actually charged lets the estimate
      // converge per model after a single turn, with no hardcoded model table.
      recordObservedTokenUsage(
        config.model,
        estimateMessagesTokens(requestMessages as ChatMessage[]),
        usage.input
      )

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

      const estimatedTokens = estimateMessagesTokens(requestMessages as ChatMessage[])
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
      const modeHookContext = {
        mode: context.chatMode,
        messages: requestMessages,
        hasWriteOps: requestMessages.some(m => {
          const readOnlyTools = getReadOnlyTools()
          return m.role === 'assistant' && m.tool_calls?.some((tc: any) => !readOnlyTools.includes(tc.function.name))
        }),
        hasSpecificTool: (toolName: string) => requestMessages.some(m =>
          m.role === 'assistant' && m.tool_calls?.some((tc: any) => tc.function.name === toolName)
        ),
        iteration,
        maxIterations,
      }
      const planReminder = context.chatMode === 'plan' && context.planPhase !== 'executing'
        ? getPlanContinuationReminder(derivePlanPlanningState(requestMessages))
        : null
      const hookResult = planReminder
        ? { shouldContinue: true, reminderMessage: planReminder }
        : executeModePostProcessHook(context.chatMode, modeHookContext)

      if (hookResult?.shouldContinue && hookResult.reminderMessage) {
        if (planReminder && assistantId) {
          const assistantMessage = threadStore.getMessages().find(message => message.id === assistantId)
          if (assistantMessage?.role === 'assistant') {
            threadStore.updateMessage(assistantId, {
              content: '',
              displayContent: undefined,
              parts: assistantMessage.parts.filter(part => part.type !== 'text'),
            })
          }
        }
        requestMessages.push({ role: 'user', content: hookResult.reminderMessage })
        shouldContinue = true
        continue
      }

      threadStore.updateExecutionMeta({ loopState: 'completed' })
      completeVisibleTodos()
      EventBus.emit({ type: 'loop:end', reason: 'complete', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    // Loop detection is advisory only: it never terminates the turn.
    //
    // Every detector result now arrives as `warning`, handled below by feeding a
    // corrective hint back to the model and continuing. Long-running tasks
    // legitimately repeat tool patterns (edit -> lint -> edit ...), and killing
    // the turn on that signal made long tasks unfinishable. `isLoop` is retained
    // on the result type for callers that want to inspect it, but the loop does
    // not branch on it.
    const routingCheck = toolRoutingAdvisor.check(result.toolCalls)
    const loopCheck = routingCheck.warning ? routingCheck : loopDetector.checkLoop(result.toolCalls)

    if (loopCheck.warning) {
      const { language } = useStore.getState()
      const isRoutingCorrection = isInternalToolRoutingCategory(loopCheck.details?.category)
      const warningTitle = isRoutingCorrection
        ? translate(language, 'agent.routing.title')
        : translate(language, 'agent.loop.title')
      const warningMessage = getLoopCheckMessage(language, loopCheck)
      const warningSuggestion = getLoopCheckSuggestion(language, loopCheck)

      logger.agent.warn(`[Loop] Non-blocking loop warning: ${loopCheck.warning}`)
      clearUnexecutedToolCards(threadStore, assistantId, result.toolCalls)
      if (!isRoutingCorrection) {
        threadStore.addSystemAlertPart(assistantId, {
          alertType: 'warning',
          title: warningTitle,
          message: warningMessage,
          suggestion: warningSuggestion,
          compact: true,
        })
        EventBus.emit({ type: 'loop:warning', message: warningMessage, threadId, assistantId, requestId, planTaskId: context.planTaskId })
      }

      requestMessages.push({
        role: 'user',
        content: isRoutingCorrection
          ? [buildToolRoutingFeedback(language, warningMessage, warningSuggestion), formatLoopDiagnostic(language, loopCheck)].filter(Boolean).join('\n\n')
          : [buildSoftLimitFeedback(language, warningTitle, warningMessage, warningSuggestion), formatLoopDiagnostic(language, loopCheck)].filter(Boolean).join('\n\n'),
      })

      shouldContinue = true
      continue
    }

    requestMessages.push({
      role: 'assistant',
      content: result.content || null,
      reasoning_content: result.reasoning,
      reasoning_signature: result.reasoningSignature,
      tool_calls: result.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    })

    const { results: toolResults, hadRejectedTool } = await executeTools(
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
      requestMessages.push({
        role: 'tool' as const,
        tool_call_id: toolCall.id,
        name: toolCall.name,
        content: toolResult.content,
      })

      // 用工具声明出来的 status，而不是从 content 猜。以前是
      // `!content.startsWith('Error:')`：命令输出以 "Error:" 开头的成功调用会
      // 被记成失败，而 'Rejected by user' 会被记成成功 —— 两种错判都会污染
      // loopDetector 的 failureRate。
      const success = toolResult.status === 'success'
      loopDetector.recordExecutedTool({
        name: toolCall.name,
        arguments: toolCall.arguments,
      }, success)
      toolRoutingAdvisor.recordExecutedTool({
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

    if (enableAutoFix && !hadRejectedTool && context.workspacePath) {
      const autoFixResult = await autoFix(result.toolCalls, context.workspacePath)
      if (autoFixResult) {
        // Key on the error set itself: a changing signature means the model is
        // making progress and keeps its budget, while an identical signature
        // means it is stuck on the same errors and should stop being nagged.
        const signature = autoFixResult.files
          .map(file => `${file.filePath}:${file.errors.map(e => `${e.line}:${e.message}`).join('|')}`)
          .sort()
          .join('\n')
        const attempts = (autoFixAttempts.get(signature) || 0) + 1
        autoFixAttempts.set(signature, attempts)

        threadStore.addLintCheckPart(assistantId)
        threadStore.updateLintCheckPart(assistantId, {
          files: autoFixResult.files,
          status: 'failed',
        })

        if (attempts <= AUTO_FIX_MAX_ATTEMPTS_PER_SIGNATURE) {
          requestMessages.push({ role: 'user', content: autoFixResult.content })
          shouldContinue = true
          threadStore.setStreamPhase('streaming')
          continue
        }

        logger.agent.warn(
          `[Loop] Auto-fix gave up after ${attempts - 1} attempts on an unchanged lint error set; continuing without re-reporting.`
        )
      }
    }

    shouldContinue = true
    threadStore.setStreamPhase('streaming')
  }

  // Only a genuine iteration-cap exhaustion gets the soft-limit treatment.
  //
  // This used to test `iteration >= maxIterations` alone, which is also true for
  // a turn that simply finished on its final allowed iteration. Every `break`
  // above (complete / error / aborted / user_rejected / handoff_required /
  // waiting_for_user / tool_requested_stop) already emitted its own `loop:end`,
  // so the old check appended a bogus "limit reached" alert, emitted a SECOND
  // `loop:end`, and fired an extra LLM request — including right after the user
  // pressed stop. `shouldContinue` is the discriminator: only the "run another
  // iteration" path at the end of the loop body leaves it true, while every
  // break path leaves it false.
  const exhaustedIterations = shouldContinue && iteration >= maxIterations && !context.abortSignal?.aborted

  if (exhaustedIterations) {
    const { language } = useStore.getState()
    const limitTitle = getLocalizedText(language, '达到工具调用上限', 'Tool Call Limit Reached')
    const limitMessage = getLocalizedText(
      language,
      `当前轮次已达到最大工具调用次数（${maxIterations} 次）。可在设置 → Agent → 最大循环中调高上限。`,
      `The agent reached this turn's tool call limit (${maxIterations}). You can raise it in Settings → Agent → Max Loops.`
    )

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
      getLocalizedText(
        language,
        '请停止继续调工具，直接总结当前进展、说明还剩哪些未完成，以便用户决定是否继续。',
        'Stop calling tools. Summarize what you accomplished and what remains, so the user can decide whether to continue.'
      )
    )
  }
}
