import type { TranslationKey } from '@shared/i18n'

export interface NotificationEventOption {
  pattern: string
  label: TranslationKey
  routine?: boolean
}
export interface NotificationEventGroup {
  label: TranslationKey
  events: NotificationEventOption[]
}

// Keep business names next to their actual event patterns; users select labels, not protocol strings.
export const NOTIFICATION_EVENT_GROUPS: NotificationEventGroup[] = [
  {
    label: 'notifications.group.agent',
    events: [
      { pattern: 'agent.loop.completed', label: 'notifications.taskComplete' },
      { pattern: 'agent.loop.failed', label: 'notifications.taskFailed' },
      { pattern: 'agent.loop.waiting', label: 'notifications.needsInput' },
      { pattern: 'agent.approval.required', label: 'notifications.needsApproval' },
      { pattern: 'agent.tool.error', label: 'notifications.toolFailed' },
      { pattern: 'agent.terminal.failed', label: 'notifications.terminalFailed' },
      { pattern: 'agent.context.warning', label: 'notifications.contextWarning' },
    ],
  },
  {
    label: 'notifications.group.plan',
    events: [
      { pattern: 'agent.plan.complete', label: 'notifications.planComplete' },
      { pattern: 'agent.plan.failed', label: 'notifications.planFailed' },
      { pattern: 'agent.plan.paused', label: 'notifications.planPaused' },
      { pattern: 'agent.task.failed', label: 'notifications.planTaskFailed' },
    ],
  },
  {
    label: 'notifications.group.workspace',
    events: [
      { pattern: 'index.completed', label: 'notifications.indexComplete' },
      { pattern: 'index.failed', label: 'notifications.indexFailed' },
      { pattern: 'asset.job.ready', label: 'notifications.assetComplete' },
      { pattern: 'asset.job.failed', label: 'notifications.assetFailed' },
      { pattern: 'asset.job.submission_unknown', label: 'notifications.assetUnknown' },
    ],
  },
  {
    label: 'notifications.group.app',
    events: [
      { pattern: 'app.update.available', label: 'notifications.updateAvailable' },
      { pattern: 'app.update.downloaded', label: 'notifications.updateDownloaded' },
      { pattern: 'app.update.error', label: 'notifications.updateFailed' },
      { pattern: 'app.renderer.crashed', label: 'notifications.windowCrashed' },
      { pattern: 'app.window.unresponsive', label: 'notifications.windowUnresponsive' },
      { pattern: 'app.connections.failed', label: 'backgroundTasks.recoveryNeeded' },
    ],
  },
  {
    label: 'notifications.group.routine',
    events: [
      { pattern: 'editor.workspace.changed', label: 'notifications.workspaceChanged', routine: true },
      { pattern: 'editor.file.activated', label: 'notifications.fileChanged', routine: true },
      { pattern: 'editor.files.changed', label: 'notifications.filesChanged', routine: true },
      { pattern: 'index.started', label: 'notifications.indexStarted', routine: true },
      { pattern: 'agent.stream.*', label: 'notifications.streamProgress', routine: true },
      { pattern: 'agent.llm.*', label: 'notifications.modelProgress', routine: true },
      { pattern: 'agent.tool.*', label: 'notifications.toolProgress', routine: true },
      { pattern: 'agent.plan.*', label: 'notifications.planProgress', routine: true },
      { pattern: 'agent.task.*', label: 'notifications.taskProgress', routine: true },
      { pattern: 'agent.loop.*', label: 'notifications.loopProgress', routine: true },
      { pattern: 'agent.context.*', label: 'notifications.contextProgress', routine: true },
      { pattern: 'agent.emotion.*', label: 'notifications.emotionProgress', routine: true },
      { pattern: 'asset.job.*', label: 'notifications.assetChanged', routine: true },
      { pattern: 'app.update.*', label: 'notifications.updateChanged', routine: true },
      { pattern: 'ui.toast.*', label: 'notifications.operationFeedback', routine: true },
    ],
  },
]

export const TASK_RESULT_EVENTS = [
  'agent.loop.completed',
  'agent.loop.failed',
  'agent.loop.waiting',
  'agent.approval.required',
]
