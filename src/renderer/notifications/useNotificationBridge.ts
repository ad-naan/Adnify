import { useEffect } from 'react'
import { api } from '../services/electronAPI'
import { EventBus } from '../agent/core/EventBus'
import { useAgentStore } from '../agent/store/AgentStore'
import { useStore } from '../store'
import { t } from '@shared/i18n'
import type { EditorEventInput } from '@shared/types/notifications'
import { editorEvents } from './events'
import { summarizeAgentEvent } from './agentEvents'

export function useNotificationBridge(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !api.notifications) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let approvalTimer: ReturnType<typeof setTimeout> | undefined
    const queue: EditorEventInput[] = []
    const passive = new Map<string, EditorEventInput>()
    const flush = () => {
      timer = undefined
      if (disposed) return
      const nextPassive = [...passive.entries()].slice(0, 10)
      const batch = [...queue.splice(0, 30), ...nextPassive.map(([, event]) => event)]
      nextPassive.forEach(([key]) => passive.delete(key))
      if (batch.length) void api.notifications.publish(batch).catch(() => {})
      if (queue.length || passive.size) timer = setTimeout(flush, 500)
    }
    const pendingThreads = new Set<string>()
    const checkApprovals = () => {
      approvalTimer = undefined
      const state = useAgentStore.getState()
      for (const thread of Object.values(state.threads)) {
        const pending = thread.streamState.phase === 'tool_pending'
        if (pending && !pendingThreads.has(thread.id))
          editorEvents.publish({
            type: 'agent.approval.required',
            level: 'warning',
            attention: true,
            title: t('notifications.needsApproval', useStore.getState().language),
            message: t('notifications.openEditor', useStore.getState().language),
            threadId: thread.id,
            correlationId: thread.executionMeta?.requestId,
          })
        if (pending) pendingThreads.add(thread.id)
        else pendingThreads.delete(thread.id)
      }
      for (const id of pendingThreads) if (!state.threads[id]) pendingThreads.delete(id)
    }
    const subscriptions = [
      editorEvents.subscribe('*', (event) => {
        if (event.attention) {
          if (queue.length < 60) queue.push(event)
        } else {
          passive.set(event.type, event)
          if (passive.size > 40) passive.delete(passive.keys().next().value!)
        }
        timer ??= setTimeout(flush, 500)
      }),
      EventBus.onAll((event) => editorEvents.publish(summarizeAgentEvent(event, useStore.getState().language))),
      // Batch streaming store updates and allow automatic tool approval to settle.
      useAgentStore.subscribe(() => {
        approvalTimer ??= setTimeout(checkApprovals, 500)
      }),
      useStore.subscribe((state, previous) => {
        if (state.workspace !== previous.workspace) {
          passive.clear()
          queue.length = 0
          editorEvents.publish({
            type: 'editor.workspace.changed',
            title: t('notifications.workspaceChanged', state.language),
            message: '',
            level: 'info',
          })
        }
        if (state.activeFilePath !== previous.activeFilePath)
          editorEvents.publish({
            type: 'editor.file.activated',
            title: t('notifications.fileChanged', state.language),
            message: '',
            level: 'info',
          })
        if (state.openFiles !== previous.openFiles)
          editorEvents.publish({
            type: 'editor.files.changed',
            title: t('notifications.filesChanged', state.language),
            message: '',
            level: 'info',
          })
      }),
      api.notifications.onActivate((event) => {
        if (event.threadId && useAgentStore.getState().threads[event.threadId]) {
          useAgentStore.getState().switchThread(event.threadId)
          useStore.getState().setChatVisible(true)
        }
      }),
    ]
    return () => {
      disposed = true
      clearTimeout(timer)
      clearTimeout(approvalTimer)
      subscriptions.forEach((unsubscribe) => unsubscribe())
    }
  }, [enabled])
}
