import { t, type Language, type TranslationKey } from './i18n'

const statusKeys: Record<string, TranslationKey> = {
  queued: 'execution.status.queued', starting: 'execution.status.starting', running: 'execution.status.running',
  stopping: 'execution.status.stopping', completed: 'execution.status.completed', failed: 'execution.status.failed',
  cancelled: 'execution.status.cancelled', expired: 'execution.status.expired', unknown: 'execution.status.unknown',
  background: 'execution.status.background', ready: 'execution.status.ready', busy: 'execution.status.busy', exited: 'execution.status.exited',
}
const reasonKeys: Record<string, TranslationKey> = {
  command_capacity: 'execution.reason.command_capacity', window_command_capacity: 'execution.reason.window_command_capacity',
  thread_command_capacity: 'execution.reason.thread_command_capacity', background_capacity: 'execution.reason.background_capacity',
  window_background_capacity: 'execution.reason.window_background_capacity', workspace_background_capacity: 'execution.reason.window_background_capacity',
  session_capacity: 'execution.reason.session_capacity', application_restarted_unconfirmed: 'execution.reason.application_restarted_unconfirmed',
  remote_result_unknown: 'execution.reason.remote_result_unknown', idle_reclaimed: 'execution.reason.idle_reclaimed',
  execution_timeout: 'execution.reason.execution_timeout', stop_failed: 'execution.reason.stop_failed',
  queue_expired: 'execution.reason.queue_expired', queue_full: 'execution.reason.queue_full',
  window_closed: 'execution.reason.window_closed', application_closed: 'execution.reason.application_closed', cancelled: 'execution.reason.cancelled',
}
export function executionStatusLabel(status: string, language: Language): string {
  const key = statusKeys[status]
  return key ? t(key, language) : status
}
export function executionReasonLabel(reason: string | undefined, language: Language): string {
  if (!reason) return ''
  const key = reasonKeys[reason]
  return key ? t(key, language) : reason
}
