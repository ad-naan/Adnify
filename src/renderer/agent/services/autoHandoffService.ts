import { logger } from '@utils/Logger'
import { t, type Language } from '@shared/i18n'
import { useStore } from '@/renderer/store'
import { useModeStore } from '@/renderer/modes/modeStore'
import { normalizeMode } from '@/shared/types/workMode'
import { Agent } from '../core/Agent'
import { getAgentConfig } from '../utils/AgentConfig'
import { useAgentStore, type HandoffSessionResult } from '../store/AgentStore'

let completedAutoHandoffKey: string | null = null

/**
 * 自动交接时注入的续跑消息。会作为一条用户消息进入线程，所以跟界面语言走。
 */
function buildAutoResumeMessage(result: HandoffSessionResult, language: Language): string {
  const pendingSteps = result.pendingSteps.slice(0, 8)
  const todos = result.todos.slice(0, 8)
  const fileChanges = result.fileChanges.slice(-8)

  const sections = [
    t('agent.autoHandoff.intro', language),
    t('agent.autoHandoff.objective', language, {
      objective: result.objective || t('agent.autoHandoff.objectiveFallback', language),
    }),
    t('agent.autoHandoff.lastRequest', language, {
      request: result.lastUserRequest || t('agent.autoHandoff.lastRequestFallback', language),
    }),
  ]

  if (pendingSteps.length > 0) {
    sections.push(t('agent.autoHandoff.pendingSteps', language, {
      steps: pendingSteps.map((step, index) => `${index + 1}. ${step}`).join('\n'),
    }))
  }

  if (todos.length > 0) {
    sections.push(t('agent.autoHandoff.todos', language, {
      todos: todos
        .map(todo => `- [${todo.status}] ${todo.status === 'in_progress' ? todo.activeForm : todo.content}`)
        .join('\n'),
    }))
  }

  if (fileChanges.length > 0) {
    sections.push(t('agent.autoHandoff.fileChanges', language, {
      changes: fileChanges.map(change => `- [${change.action}] ${change.path}`).join('\n'),
    }))
  }

  sections.push(t('agent.autoHandoff.outro', language))
  return sections.join('\n\n')
}

async function continueAutoHandoff(result: HandoffSessionResult): Promise<void> {
  const appState = useStore.getState()
  const modeState = useModeStore.getState()
  const sourceMode = normalizeMode(useAgentStore.getState().threads[result.threadId]?.mode || modeState.currentMode)
  const agentConfig = getAgentConfig()

  await Agent.send(
    buildAutoResumeMessage(result, appState.language),
    {
      ...appState.llmConfig,
      contextLimit: agentConfig.maxContextTokens,
    },
    appState.workspacePath,
    sourceMode,
    {
      openFiles: appState.openFiles.map(file => file.path),
      activeFile: appState.activeFilePath || undefined,
      customInstructions: appState.aiInstructions,
      promptTemplateId: appState.promptTemplateId,
    },
    {
      threadId: result.threadId,
    }
  )
}

export async function executeAutoHandoff(threadId: string, handoffCreatedAt: number): Promise<boolean> {
  const handoffKey = `${threadId}:${handoffCreatedAt}`
  if (completedAutoHandoffKey === handoffKey) {
    return false
  }

  const state = useAgentStore.getState()
  const thread = state.threads[threadId]
  const liveCreatedAt = thread?.handoff.document?.createdAt ?? null

  if (!thread || thread.handoff.status !== 'ready' || liveCreatedAt !== handoffCreatedAt) {
    logger.agent.warn('[AutoHandoffService] Skipped automatic handoff because source state is not ready', {
      threadId,
      expectedCreatedAt: handoffCreatedAt,
      liveCreatedAt,
      status: thread?.handoff.status,
    })
    return false
  }

  logger.agent.info('[AutoHandoffService] Creating handoff session', { threadId, handoffCreatedAt })
  const result = state.createHandoffSession(threadId)
  if (!result) {
    logger.agent.warn('[AutoHandoffService] Failed to create handoff session', { threadId, handoffCreatedAt })
    return false
  }

  completedAutoHandoffKey = handoffKey

  try {
    await continueAutoHandoff(result)
    return true
  } catch (error) {
    completedAutoHandoffKey = null
    logger.agent.error('[AutoHandoffService] Failed to continue handoff thread', {
      threadId: result.threadId,
      error,
    })
    return false
  }
}
