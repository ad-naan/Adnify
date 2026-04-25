import { logger } from '@utils/Logger'
import { useStore } from '@/renderer/store'
import { useModeStore } from '@/renderer/modes/modeStore'
import { Agent } from '../core/Agent'
import { getAgentConfig } from '../utils/AgentConfig'
import { useAgentStore, type HandoffSessionResult } from '../store/AgentStore'

let completedAutoHandoffKey: string | null = null

function buildAutoResumeMessage(result: HandoffSessionResult, language: 'zh' | 'en'): string {
  const pendingSteps = result.pendingSteps.slice(0, 8)
  const todos = result.todos.slice(0, 8)
  const fileChanges = result.fileChanges.slice(-8)

  if (language === 'zh') {
    const sections = [
      '这是一次自动上下文交接，请直接基于当前线程中的交接摘要继续执行，不要从头开始。',
      `当前目标：${result.objective || '继续上一线程的任务'}`,
      `最近一条用户消息：${result.lastUserRequest || '无'}`,
    ]

    if (pendingSteps.length > 0) {
      sections.push(`待办步骤：\n${pendingSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`)
    }

    if (todos.length > 0) {
      sections.push(
        `任务列表：\n${todos
          .map(todo => `- [${todo.status}] ${todo.status === 'in_progress' ? todo.activeForm : todo.content}`)
          .join('\n')}`
      )
    }

    if (fileChanges.length > 0) {
      sections.push(
        `最近文件变更：\n${fileChanges
          .map(change => `- [${change.action}] ${change.path}`)
          .join('\n')}`
      )
    }

    sections.push('请先承接当前状态，再继续完成未完成事项。')
    return sections.join('\n\n')
  }

  const sections = [
    'This is an automatic context handoff. Continue from the handoff snapshot in this thread and do not restart from scratch.',
    `Current objective: ${result.objective || 'Continue the previous task'}`,
    `Latest user message: ${result.lastUserRequest || 'None'}`,
  ]

  if (pendingSteps.length > 0) {
    sections.push(`Pending steps:\n${pendingSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`)
  }

  if (todos.length > 0) {
    sections.push(
      `Task list:\n${todos
        .map(todo => `- [${todo.status}] ${todo.status === 'in_progress' ? todo.activeForm : todo.content}`)
        .join('\n')}`
    )
  }

  if (fileChanges.length > 0) {
    sections.push(
      `Recent file changes:\n${fileChanges
        .map(change => `- [${change.action}] ${change.path}`)
        .join('\n')}`
    )
  }

  sections.push('Resume from the carried-over state first, then continue the unfinished work.')
  return sections.join('\n\n')
}

async function continueAutoHandoff(result: HandoffSessionResult): Promise<void> {
  const appState = useStore.getState()
  const modeState = useModeStore.getState()
  const agentConfig = getAgentConfig()
  const language = (appState.language || 'zh') as 'zh' | 'en'

  await Agent.send(
    buildAutoResumeMessage(result, language),
    {
      ...appState.llmConfig,
      contextLimit: agentConfig.maxContextTokens,
    },
    appState.workspacePath,
    modeState.currentMode,
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
