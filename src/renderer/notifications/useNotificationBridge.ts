import { useEffect } from 'react'
import { api } from '../services/electronAPI'
import { EventBus } from '../agent/core/EventBus'
import { useAgentStore } from '../agent/store/AgentStore'
import { useStore } from '../store'
import { toast } from '../components/common/ToastProvider'
import { t } from '@shared/i18n'
import type { EditorEventInput } from '@shared/types/notifications'
import { editorEvents } from './events'
import { summarizeAgentEvent } from './agentEvents'
import { acceptNotificationSnapshot, useNotifications } from './store'

export function useNotificationBridge(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !api.notifications) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let approvalTimer: ReturnType<typeof setTimeout> | undefined
    let workspaceRevision = 0
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
    useNotifications.setState({ revision: -1, records: [] })
    const pendingThreads = new Set<string>()
    const loadHistory = () => {
      const revision = ++workspaceRevision
      void api.notifications
        .history()
        .then((snapshot) => {
          if (!disposed && revision === workspaceRevision) acceptNotificationSnapshot(snapshot)
        })
        .catch(() => {})
    }
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
          useNotifications.setState({ revision: -1, records: [] })
          loadHistory()
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
      api.notifications.onUpdate((update) => {
        acceptNotificationSnapshot(update.snapshot)
        if (update.toast)
          toast.card({
            type: update.toast.level,
            title: update.toast.title,
            message: update.toast.message,
            duration: 5000,
            source: 'notification-center',
            dedupeKey: update.toast.id,
            record: false,
            actions: [
              {
                id: 'open',
                label: t('notifications.open', useStore.getState().language),
                onClick: () => {
                  void api.notifications.activate(update.toast!.id).catch(() => {})
                },
              },
            ],
          })
      }),
      api.notifications.onActivate((event) => {
        if (event.threadId && useAgentStore.getState().threads[event.threadId]) {
          useAgentStore.getState().switchThread(event.threadId)
          useStore.getState().setChatVisible(true)
        }
      }),
    ]
    loadHistory()
    return () => {
      disposed = true
      clearTimeout(timer)
      clearTimeout(approvalTimer)
      subscriptions.forEach((unsubscribe) => unsubscribe())
    }
  }, [enabled])
}
