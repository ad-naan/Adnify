import type { AgentEvent } from '../agent/core/EventBus'
import { isSuccessfulLoopEnd } from '../agent/core/EventBus'
import { t, type Language, type TranslationKey } from '@shared/i18n'
import type { EditorEventInput } from '@shared/types/notifications'

export function summarizeAgentEvent(event: AgentEvent, language: Language): EditorEventInput {
  const type = `agent.${event.type.replaceAll(':', '.')}`
  let key: TranslationKey = 'notifications.agentState'
  let level: EditorEventInput['level'] = 'info'
  let attention = false
  let resultType = type
  switch (event.type) {
    case 'loop:end':
      if (isSuccessfulLoopEnd(event.reason)) {
        key = 'notifications.taskComplete'
        level = 'success'
        attention = true
        resultType = 'agent.loop.completed'
      } else if (event.reason === 'error') {
        key = 'notifications.taskFailed'
        level = 'error'
        attention = true
        resultType = 'agent.loop.failed'
      } else if (event.reason === 'waiting_for_user' || event.reason === 'handoff_required') {
        key = 'notifications.needsInput'
        level = 'warning'
        attention = true
        resultType = 'agent.loop.waiting'
      }
      break
    case 'plan:complete':
      key = 'notifications.planComplete'
      level = 'success'
      attention = true
      break
    case 'plan:failed':
      key = 'notifications.planFailed'
      level = 'error'
      attention = true
      break
    case 'plan:paused':
      key = 'notifications.planPaused'
      level = 'warning'
      attention = true
      break
    case 'tool:error':
      key = 'notifications.toolFailed'
      level = 'error'
      attention = true
      break
    case 'task:failed':
      key = 'notifications.taskFailed'
      level = 'error'
      attention = true
      break
    case 'terminal:failed':
      key = 'notifications.terminalFailed'
      level = 'error'
      attention = true
      break
    case 'context:warning':
      key = 'notifications.contextWarning'
      level = 'warning'
      attention = true
      break
  }
  return {
    type: resultType,
    title: t(key, language),
    message: t('notifications.openEditor', language),
    level,
    attention,
    threadId: 'threadId' in event ? event.threadId : undefined,
    correlationId:
      'requestId' in event ? event.requestId : 'planId' in event ? event.planId : 'id' in event ? event.id : undefined,
  }
}
