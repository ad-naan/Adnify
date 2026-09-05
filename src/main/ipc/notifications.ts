import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { safeIpcHandle } from './safeHandle'
import { NotificationRuntime, type NotificationContext } from '../services/notifications/runtime'
import { editorEventSchema } from '../services/notifications/config'
import type { EditorEvent } from '@shared/types/notifications'
import { logger } from '@shared/utils/Logger'

let runtime: NotificationRuntime | undefined
let ready: Promise<void> | undefined
const limits = new Map<number, { start: number; count: number }>()
function owner(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || window.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame)
    throw new Error('Notifications require the application main frame')
  return window
}
export function registerNotificationHandlers(context: NotificationContext): void {
  runtime = new NotificationRuntime(context)
  ready = runtime.initialize()
  void ready.catch(() => logger.system.error('[Notifications] Initialization failed'))
  const handle = (name: string, handler: (window: BrowserWindow, raw: unknown) => unknown) =>
    safeIpcHandle(`notifications:${name}`, async (event, raw: unknown) => {
      const window = owner(event)
      await ready
      return handler(window, raw)
    })
  handle('publish', (window, raw) => {
    const batch = z.array(editorEventSchema).max(40).parse(raw)
    const time = Date.now(),
      limit = limits.get(window.id)
    const next = !limit || time - limit.start >= 1000 ? { start: time, count: 0 } : limit
    next.count += batch.length
    limits.set(window.id, next)
    while (limits.size > 100) limits.delete(limits.keys().next().value!)
    if (next.count > 120) throw new Error('Editor event rate limit exceeded')
    for (const input of batch)
      runtime!.service.publish(input, { windowId: window.id, workspace: context.getWindowWorkspace?.(window.id)?.[0] })
  })
  handle('history', (window) => runtime!.history(window))
  handle('settings', () => runtime!.settings())
  handle('saveSettings', (_window, raw) => runtime!.saveSettings(raw))
  handle('markRead', (window, raw) =>
    runtime!.service.markRead(z.array(z.string().max(100)).max(200).parse(raw), (event) =>
      runtime!.visible(window, event),
    ),
  )
  handle('clear', (window) => runtime!.service.clear((event) => runtime!.visible(window, event)))
  handle('activate', (window, raw) => {
    const id = z.string().max(100).parse(raw)
    const record = runtime!.history(window).records.find((item) => item.event.id === id)
    if (record) runtime!.activate(record.event)
  })
  handle('test', (window, raw) => {
    const channel = z.string().max(80).parse(raw)
    const event: EditorEvent = {
      id: randomUUID(),
      type: 'notification.test',
      title: 'Adnify',
      message: 'Notification channel test',
      level: 'info',
      timestamp: Date.now(),
      windowId: window.id,
    }
    return runtime!.service.test(channel, event)
  })
}
export async function cleanupNotificationHandlers(): Promise<void> {
  limits.clear()
  await ready?.catch(() => {})
  await runtime?.stop()
}
