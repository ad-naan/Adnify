import { logger } from '@utils/Logger'
import { useStore } from '@/renderer/store'
import { generateHandoffDocument } from '../domains/context/summaryService'
import type { ThreadBoundStore } from '../store/AgentStore'
import { useAgentStore, type HandoffSessionResult } from '../store/AgentStore'
import type { ChatThread } from '../types'
import { getMessageText, type UserMessage } from '../types'
import type { HandoffDocument, StructuredSummary } from '../domains/context/types'

export interface PreparedHandoffResult {
  handoff: HandoffDocument
  source: 'llm' | 'rule_based'
  error?: string
}

function getThreadOrThrow(threadId: string) {
  const state = useAgentStore.getState()
  const thread = state.threads[threadId]

  if (!thread) {
    throw new Error(`Thread not found: ${threadId}`)
  }

  return { state, thread }
}

function getExistingHandoffTurns(thread: ChatThread): number {
  const handoffDocument = thread.handoff.document
  if (!handoffDocument) return -1
  return handoffDocument.summary.turnRange?.[1] ?? -1
}

function buildFallbackHandoffDocument(thread: ChatThread, workspacePath: string): HandoffDocument {
  const userRequests = thread.messages
    .filter((message): message is UserMessage => message.role === 'user')
    .map(message => getMessageText(message.content).trim())
    .filter(Boolean)

  const generatedAt = Date.now()
  const lastUserRequest = userRequests[userRequests.length - 1] || thread.pendingObjective || 'Continue the previous task.'
  const summary: StructuredSummary = thread.contextSummary ? {
    ...thread.contextSummary,
    pendingSteps: thread.contextSummary.pendingSteps?.length
      ? thread.contextSummary.pendingSteps
      : [lastUserRequest],
    todos: thread.todos || thread.contextSummary.todos || [],
    userInstructions: thread.contextSummary.userInstructions?.length
      ? thread.contextSummary.userInstructions
      : userRequests.slice(-5),
    generatedAt,
    turnRange: [0, userRequests.length],
  } : {
    objective: thread.pendingObjective || lastUserRequest,
    completedSteps: [],
    pendingSteps: thread.pendingSteps?.length ? thread.pendingSteps : [lastUserRequest],
    todos: thread.todos || [],
    decisions: [],
    fileChanges: [],
    errorsAndFixes: [],
    userInstructions: userRequests.slice(-5),
    generatedAt,
    turnRange: [0, userRequests.length],
  }

  return {
    fromSessionId: thread.id,
    createdAt: generatedAt,
    summary,
    workingDirectory: workspacePath,
    keyFileSnapshots: [],
    lastUserRequest,
    suggestedNextSteps: summary.pendingSteps,
  }
}

export async function prepareHandoffForThread(
  threadId: string,
  options?: {
    threadStore?: ThreadBoundStore
    workspacePath?: string
  },
): Promise<PreparedHandoffResult> {
  const { state, thread } = getThreadOrThrow(threadId)
  const workspacePath = options?.workspacePath ?? useStore.getState().workspacePath ?? ''
  const threadStore = options?.threadStore ?? state.forThread(threadId)
  const userTurns = thread.messages.filter(message => message.role === 'user').length
  const existingHandoffTurns = getExistingHandoffTurns(thread)

  if (userTurns <= existingHandoffTurns && thread.handoff.document) {
    if (thread.handoff.status !== 'ready') {
      threadStore.setHandoffState({
        ...thread.handoff,
        status: 'ready',
        error: undefined,
      })
    }

    return {
      handoff: thread.handoff.document,
      source: thread.handoff.source ?? (thread.handoff.error ? 'rule_based' : 'llm'),
    }
  }

  logger.agent.info('[HandoffSessionService] Preparing handoff snapshot', {
    threadId,
    workspacePath,
  })

  state.setContextTransition({
    status: 'compressing',
    sourceThreadId: threadId,
    startedAt: Date.now(),
  })

  try {
    const generated = await generateHandoffDocument(
      thread.id,
      thread.messages,
      workspacePath,
      thread.todos || [],
    )

    const handoff = generated.handoff
    state.setContextSummary(handoff.summary, threadId)
    threadStore.setHandoffState({
      status: 'ready',
      document: handoff,
      source: generated.source,
      createdAt: handoff.createdAt,
      error: generated.error,
    })

    return {
      handoff,
      source: generated.source,
      error: generated.error,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.agent.error('[HandoffSessionService] Failed to generate handoff document, using fallback packet:', error)

    const handoff = buildFallbackHandoffDocument(thread, workspacePath)
    state.setContextSummary(handoff.summary, threadId)
    threadStore.setHandoffState({
      status: 'ready',
      document: handoff,
      source: 'rule_based',
      createdAt: handoff.createdAt,
      error: message,
    })

    return {
      handoff,
      source: 'rule_based',
      error: message,
    }
  } finally {
    const transition = useAgentStore.getState().contextTransition
    if (transition.status === 'compressing' && transition.sourceThreadId === threadId) {
      useAgentStore.getState().clearContextTransition()
    }
  }
}

export async function createManualHandoffSession(threadId: string): Promise<HandoffSessionResult> {
  await prepareHandoffForThread(threadId)

  const result = useAgentStore.getState().createHandoffSession(threadId)
  if (!result) {
    throw new Error('Failed to create handoff session')
  }

  logger.agent.info('[HandoffSessionService] Created manual handoff session', {
    sourceThreadId: threadId,
    targetThreadId: result.threadId,
  })

  return result
}
