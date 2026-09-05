import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { safeIpcHandle } from './safeHandle'
import { backgroundTaskService } from '../services/backgroundTasks/BackgroundTaskService'
import { checkConnections } from '../services/backgroundTasks/checkConnections'
import { mcpManager } from '../services/mcp'

const activitySchema = z.object({
  state: z.enum(['idle', 'running', 'paused', 'error']),
  progress: z.number().finite().min(0).max(1).optional(),
  model: z.object({ provider: z.string().max(200), baseUrl: z.string().max(4096).optional() }).strict().optional(),
}).strict()

function owner(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || window.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Background tasks require the application main frame')
  }
  return window
}

let unsubscribeSettings: (() => void) | undefined
export function registerBackgroundTaskHandlers(preferences: {
  get(key: 'backgroundTaskSettings'): unknown
  onDidChange(key: 'backgroundTaskSettings', callback: () => void): () => void
}): void {
  backgroundTaskService.start(() => preferences.get('backgroundTaskSettings'), model =>
    checkConnections(model, () => mcpManager.checkConnections()))
  unsubscribeSettings = preferences.onDidChange('backgroundTaskSettings', () => backgroundTaskService.refresh())
  safeIpcHandle('backgroundTasks:update', (event, raw: unknown) => {
    backgroundTaskService.update(owner(event), activitySchema.parse(raw))
    return true
  })
  safeIpcHandle('backgroundTasks:getConnections', event => backgroundTaskService.getConnections(owner(event)))
  safeIpcHandle('backgroundTasks:check', event => backgroundTaskService.check(owner(event)))
}

export function cleanupBackgroundTaskHandlers(): void {
  unsubscribeSettings?.()
  unsubscribeSettings = undefined
  backgroundTaskService.stop()
}
