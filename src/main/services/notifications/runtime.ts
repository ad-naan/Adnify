import { app, BrowserWindow, Notification, net, safeStorage } from 'electron'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createScopedStore, getUserConfigDir } from '../configPath'
import { mainEditorEvents } from './events'
import { NotificationService, webhookAccepts } from './NotificationService'
import { defaultNotificationSettings, notificationSettingsSchema } from './config'
import { sendWebhook } from './webhook'
import {
  matchesNotification,
  type EditorEvent,
  type NotificationRecord,
  type NotificationSettings,
  type NotificationSnapshot,
} from '@shared/types/notifications'
import { logger } from '@shared/utils/Logger'
import { asLanguage, tDynamic } from '@shared/i18n'

export interface NotificationContext {
  getWindowWorkspace?: (windowId: number) => string[] | null
  getLanguage?: () => string
}
export class NotificationRuntime {
  private config = defaultNotificationSettings()
  private store = createScopedStore('notifications')
  private historyPath = path.join(getUserConfigDir(), 'notification-history.json')
  private saveTimer?: ReturnType<typeof setTimeout>
  private writing = Promise.resolve()
  private unsubscribe?: () => void
  private webhookDisposers: Array<() => void> = []
  private native = new Set<Notification>()
  private initialized = false
  readonly service = new NotificationService({
    settings: () => this.config,
    changed: () => this.changed(),
  })
  constructor(private context: NotificationContext) {}
  async initialize(): Promise<void> {
    const saved = this.store.get('settings')
    const encrypted = this.store.get('webhooks') as string | undefined
    const webhooks = encrypted ? JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))) : []
    if (saved) this.config = notificationSettingsSchema.parse({ ...(saved as object), webhooks })
    this.registerChannels()
    try {
      if ((await fs.stat(this.historyPath)).size > 2_000_000) throw new Error('History exceeds size limit')
      const raw = JSON.parse(await fs.readFile(this.historyPath, 'utf8'))
      if (Array.isArray(raw)) {
        // Disk state is bounded and must not introduce arbitrary properties on events.
        const { editorEventSchema } = await import('./config')
        const records: NotificationRecord[] = []
        for (const item of raw.slice(0, 200)) {
          const { id, timestamp, windowId: _windowId, workspace, ...input } = item.event ?? {}
          // Window IDs are not stable across launches. Do not make a window-local record global.
          if (_windowId !== undefined && typeof workspace !== 'string') continue
          if (typeof id !== 'string' || id.length > 100 || !Number.isFinite(timestamp)) continue
          const parsed = editorEventSchema.safeParse(input)
          if (!parsed.success) continue
          const deliveries: NotificationRecord['deliveries'] = {}
          for (const [channel, value] of Object.entries(item.deliveries ?? {}).slice(0, 7)) {
            const delivery = value as { state?: string; error?: string }
            if (['pending', 'delivered', 'failed', 'skipped'].includes(delivery?.state ?? ''))
              deliveries[channel] = {
                state: delivery.state as NotificationRecord['deliveries'][string]['state'],
                error: typeof delivery.error === 'string' ? delivery.error.slice(0, 100) : undefined,
              }
          }
          records.push({
            event: {
              ...parsed.data,
              id,
              timestamp,
              workspace: typeof workspace === 'string' ? workspace.slice(0, 4096) : undefined,
            },
            read: !!item.read,
            deliveries,
          })
        }
        this.service.restore(records)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        logger.system.warn('[Notifications] History could not be restored')
    }
    this.unsubscribe = mainEditorEvents.subscribe('*', (event) => {
      const { windowId, workspace, ...input } = event
      const language = asLanguage(this.context.getLanguage?.())
      this.service.publish(
        {
          ...input,
          title: tDynamic(input.title, language, input.title),
          message: tDynamic(input.message, language, input.message),
        },
        { windowId, workspace: workspace ?? (windowId ? this.context.getWindowWorkspace?.(windowId)?.[0] : undefined) },
      )
    })
    if (process.platform === 'win32') app.setAppUserModelId('com.adnify.app')
    this.initialized = true
  }
  settings(): NotificationSettings {
    return structuredClone(this.config)
  }
  saveSettings(raw: unknown): NotificationSettings {
    const config = notificationSettingsSchema.parse(raw)
    if (
      config.webhooks.length &&
      (!safeStorage.isEncryptionAvailable() ||
        (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'))
    ) {
      throw new Error('OS credential encryption is unavailable')
    }
    const { webhooks, ...settings } = config
    const encrypted = webhooks.length
      ? safeStorage.encryptString(JSON.stringify(webhooks)).toString('base64')
      : undefined
    // One store write keeps public settings and encrypted destinations consistent.
    this.store.store = { settings, ...(encrypted ? { webhooks: encrypted } : {}) }
    this.config = config
    this.registerChannels()
    return this.settings()
  }
  private registerChannels(): void {
    this.webhookDisposers.forEach((dispose) => dispose())
    this.webhookDisposers = []
    this.service.registerChannel({
      id: 'system',
      accepts: (event, settings) => settings.system.enabled && matchesNotification(settings.system, event),
      deliver: (event, settings, signal) => this.showSystem(event, settings, signal),
    })
    for (const hook of this.config.webhooks)
      this.webhookDisposers.push(
        this.service.registerChannel({
          id: hook.id,
          accepts: (event, settings) => webhookAccepts(hook.id, event, settings),
          deliver: async (event, settings, signal) => {
            const current = settings.webhooks.find((item) => item.id === hook.id)
            if (!current) return 'skipped'
            await sendWebhook(current, event, net.fetch.bind(net) as typeof fetch, signal)
            return 'delivered'
          },
        }),
      )
  }
  visible(window: BrowserWindow, event: EditorEvent): boolean {
    const roots = this.context.getWindowWorkspace?.(window.id) ?? []
    return event.workspace ? roots.includes(event.workspace) : event.windowId ? event.windowId === window.id : true
  }
  history(window: BrowserWindow): NotificationSnapshot {
    const snapshot = this.service.snapshot()
    snapshot.records = snapshot.records.filter((record) => this.visible(window, record.event))
    return snapshot
  }
  private changed(): void {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.persist(), 300)
  }
  private persist(): void {
    clearTimeout(this.saveTimer)
    if (!this.initialized) return
    const data = JSON.stringify(this.service.snapshot().records)
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(path.dirname(this.historyPath), { recursive: true })
        const temporary = this.historyPath + '.tmp'
        await fs.writeFile(temporary, data, { mode: 0o600 })
        await fs.rename(temporary, this.historyPath)
      })
    void this.writing.catch(() => logger.system.warn('[Notifications] History could not be saved'))
  }
  private owner(event: EditorEvent): BrowserWindow | undefined {
    const windows = BrowserWindow.getAllWindows().filter(
      (window) => !window.isDestroyed() && this.visible(window, event),
    )
    return (
      windows.find((window) => window.id === event.windowId) ??
      windows.find((window) => window.isFocused()) ??
      windows[0]
    )
  }
  activate(event: EditorEvent): void {
    const window = this.owner(event)
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    window.webContents.send('notifications:activate', event)
    this.service.markRead([event.id], (item) => this.visible(window, item))
  }
  private showSystem(
    event: EditorEvent,
    settings: NotificationSettings,
    signal: AbortSignal,
  ): Promise<'delivered' | 'skipped'> {
    const window = this.owner(event)
    if (!Notification.isSupported() || (settings.system.onlyWhenUnfocused && window?.isFocused()))
      return Promise.resolve('skipped')
    return new Promise((resolve, reject) => {
      const notification = new Notification({ title: event.title, body: event.message, silent: !settings.system.sound })
      this.native.add(notification)
      const dispose = () => {
        this.native.delete(notification)
        signal.removeEventListener('abort', abort)
      }
      const abort = () => {
        notification.close()
        dispose()
        reject(new Error('Stopped'))
      }
      signal.addEventListener('abort', abort, { once: true })
      notification.once('show', () => {
        signal.removeEventListener('abort', abort)
        resolve('delivered')
      })
      notification.once('failed', () => {
        dispose()
        reject(new Error('System notification failed'))
      })
      notification.once('close', dispose)
      notification.once('click', () => {
        this.activate(event)
        dispose()
      })
      try {
        notification.show()
      } catch (error) {
        dispose()
        reject(error)
      }
      // Keep click handlers alive, but bound references if an OS never emits close.
      while (this.native.size > 50) {
        const old = this.native.values().next().value!
        old.close()
        this.native.delete(old)
      }
    })
  }
  async stop(): Promise<void> {
    this.unsubscribe?.()
    this.service.stop()
    for (const notification of this.native) notification.close()
    this.native.clear()
    this.persist()
    await this.writing.catch(() => {})
  }
}
