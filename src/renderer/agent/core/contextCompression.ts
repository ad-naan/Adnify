import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { useAgentStore, type ThreadBoundStore } from '../store/AgentStore'
import { EventBus } from './EventBus'
import { generateSummary } from '../domains/context'
import { LEVEL_NAMES, updateStats, type CompressionStats } from '../domains/context/CompressionManager'
import { executeAutoHandoff } from '../services/autoHandoffService'
import { prepareHandoffForThread, type PreparedHandoffResult } from '../services/handoffSessionService'
import { getMessageText, type ChatMessage, type ChatThread, type UserMessage } from '../types'
import { pickLocalizedText } from '../utils/agentText'
import type { TokenBudgetController } from '../domains/budget/TokenBudgetController'
import type { StructuredSummary } from '../domains/context/types'
import type { ExecutionContext } from './types'

export interface CompressionCheckResult {
  level: 0 | 1 | 2 | 3 | 4
  needsHandoff: boolean
}

function getLocalizedText(language: string, zh: string, en: string): string {
  return pickLocalizedText(zh, en, language as 'en' | 'zh')
}

function shouldRefreshSummary(summary: StructuredSummary | null | undefined, userTurns: number, minDelta = 2): boolean {
  if (!summary) return true
  return userTurns >= (summary.turnRange?.[1] ?? 0) + minDelta
}

function getLiveThread(threadId: string): ChatThread | null {
  return useAgentStore.getState().threads[threadId] || null
}

function getRecentUserRequests(messages: ChatMessage[], limit = 5): string[] {
  return messages
    .filter((message): message is UserMessage => message.role === 'user')
    .map(message => getMessageText(message.content).trim())
    .filter(Boolean)
    .slice(-limit)
}

function buildStructuredSummary(
  summaryResult: Awaited<ReturnType<typeof generateSummary>>,
  userTurns: number,
  userInstructions: string[] = []
): StructuredSummary {
  return {
    objective: summaryResult.objective,
    completedSteps: summaryResult.completedSteps,
    pendingSteps: summaryResult.pendingSteps,
    todos: summaryResult.todos,
    decisions: [],
    fileChanges: summaryResult.fileChanges,
    errorsAndFixes: [],
    userInstructions,
    generatedAt: Date.now(),
    turnRange: [0, userTurns],
  }
}

async function executeAutoHandoffIfNeeded(
  threadId: string,
  handoffResult: PreparedHandoffResult | null,
  autoHandoff: boolean
): Promise<boolean> {
  if (!handoffResult || !autoHandoff) {
    return false
  }

  return executeAutoHandoff(threadId, handoffResult.handoff.createdAt)
}

function emitCompressionWarning(
  usage: { input: number; output: number },
  contextLimit: number,
  ratio: number,
  budgetController?: TokenBudgetController
) {
  const estimatedRemainingTurns = budgetController
    ? budgetController.estimateRemainingTurns(usage.input, usage.output)
    : Math.floor((1 - ratio) * contextLimit / Math.max(1, usage.input + usage.output))

  EventBus.emit({
    type: 'context:warning',
    level: 3,
    message: `Context usage is high (${(ratio * 100).toFixed(1)}%). Estimated ${estimatedRemainingTurns} turns remaining.`,
  })
}

function emitContextLimitAlert(threadStore: ThreadBoundStore, assistantId: string) {
  const { language } = useStore.getState()
  threadStore.addSystemAlertPart(assistantId, {
    alertType: 'warning',
    title: getLocalizedText(language, '上下文已满', 'Context Limit Reached'),
    message: getLocalizedText(language, '当前对话已达到上下文限制，请开始新会话继续。', 'Please start a new session to continue.'),
  })
}

async function ensureSummarySnapshot(threadId: string, threadStore: ThreadBoundStore): Promise<void> {
  const thread = getLiveThread(threadId)
  if (!thread) return

  const userTurns = thread.messages.filter(message => message.role === 'user').length

  if (shouldRefreshSummary(thread.contextSummary, userTurns)) {
    const recentUserRequests = getRecentUserRequests(thread.messages)
    const summaryResult = await generateSummary(thread.messages, { type: 'detailed', todos: thread.todos })
    const structuredSummary = buildStructuredSummary(summaryResult, userTurns, recentUserRequests)
    threadStore.setContextSummary(structuredSummary)
    EventBus.emit({ type: 'context:summary', summary: summaryResult.summary })
  }
}

async function ensureHandoffSnapshot(
  threadId: string,
  threadStore: ThreadBoundStore,
  context: ExecutionContext,
  autoHandoff: boolean
): Promise<boolean> {
  const thread = getLiveThread(threadId)
  if (!thread) return false

  const handoffWorkspace = context.workspacePath || useStore.getState().workspacePath || ''
  const handoffResult = await prepareHandoffForThread(thread.id, {
    threadStore,
    workspacePath: handoffWorkspace,
  })
  const didAutoHandoff = await executeAutoHandoffIfNeeded(thread.id, handoffResult, autoHandoff)

  if (handoffResult) {
    EventBus.emit({ type: 'context:handoff', document: handoffResult.handoff })
  }

  return didAutoHandoff
}

async function applyCompressionActions(
  calculatedLevel: CompressionCheckResult['level'],
  ratio: number,
  totalTokens: number,
  usage: { input: number; output: number },
  contextLimit: number,
  previousStats: CompressionStats | null,
  thread: ChatThread | null,
  threadId: string,
  threadStore: ThreadBoundStore,
  context: ExecutionContext,
  assistantId: string,
  enableLLMSummary: boolean,
  autoHandoff: boolean,
  budgetController?: TokenBudgetController
): Promise<CompressionCheckResult> {
  if (calculatedLevel === 3 && (!previousStats || previousStats.level < 3)) {
    emitCompressionWarning(usage, contextLimit, ratio, budgetController)
  }

  if (calculatedLevel >= 3 && enableLLMSummary && thread) {
    threadStore.setCompressionPhase('summarizing')
    try {
      await ensureSummarySnapshot(threadId, threadStore)
    } catch {
      // Summary generation failed, not critical
    } finally {
      threadStore.setCompressionPhase('idle')
    }
  }

  let didAutoHandoff = false
  if (calculatedLevel >= 4) {
    if (thread) {
      threadStore.setCompressionPhase('summarizing')
      try {
        didAutoHandoff = await ensureHandoffSnapshot(threadId, threadStore, context, autoHandoff)
      } finally {
        threadStore.setCompressionPhase('idle')
      }
    }

    if (!didAutoHandoff) {
      emitContextLimitAlert(threadStore, assistantId)
    }
  }

  EventBus.emit({ type: 'context:level', level: calculatedLevel, tokens: totalTokens, ratio })

  return { level: calculatedLevel, needsHandoff: calculatedLevel >= 4 }
}

export async function checkAndHandleCompression(
  usage: { input: number; output: number },
  contextLimit: number,
  threadStore: ThreadBoundStore,
  threadId: string,
  context: ExecutionContext,
  assistantId: string,
  enableLLMSummary: boolean,
  autoHandoff: boolean,
  budgetController?: TokenBudgetController
): Promise<CompressionCheckResult> {
  const thread = getLiveThread(threadId)
  const messageCount = thread?.messages.length || 0
  const previousStats = thread?.compressionStats || null
  const newStats = updateStats(
    { promptTokens: usage.input, completionTokens: usage.output },
    contextLimit,
    previousStats,
    messageCount
  )
  const reconciliation = budgetController?.reconcile(
    usage.input,
    usage.output,
    usage.input
  )
  const calculatedLevel = reconciliation?.calculatedLevel ?? newStats.level
  const ratio = reconciliation?.actualUsageRatio ?? newStats.ratio
  const totalTokens = reconciliation
    ? reconciliation.actualInputTokens + reconciliation.actualOutputTokens
    : newStats.inputTokens + newStats.outputTokens

  logger.agent.info(
    `[Compression] L${calculatedLevel} (${LEVEL_NAMES[calculatedLevel]}), ` +
    `ratio: ${(ratio * 100).toFixed(1)}%, ` +
    `tokens: ${totalTokens}/${contextLimit}`
  )

  threadStore.setCompressionStats(newStats)
  threadStore.setCompressionPhase('idle')

  return applyCompressionActions(
    calculatedLevel,
    ratio,
    totalTokens,
    usage,
    contextLimit,
    previousStats,
    thread,
    threadId,
    threadStore,
    context,
    assistantId,
    enableLLMSummary,
    autoHandoff,
    budgetController
  )
}
