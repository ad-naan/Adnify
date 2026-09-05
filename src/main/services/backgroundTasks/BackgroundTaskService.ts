import { BrowserWindow, powerMonitor, powerSaveBlocker } from 'electron'
import {
  normalizeBackgroundTaskSettings,
  type BackgroundTaskActivity,
  type BackgroundConnectionState,
  type ConnectionReport,
} from '@shared/types/backgroundTasks'

interface WindowActivity {
  window: BrowserWindow
  activity: BackgroundTaskActivity
  updatedAt: number
  presentation?: string
  connections: BackgroundConnectionState
  pendingCheck?: Promise<BackgroundConnectionState>
  modelRevision: number
  dispose: () => void
}

export class BackgroundTaskService {
  private records = new Map<number, WindowActivity>()
  private blockerId: number | undefined
  private watchdog?: ReturnType<typeof setInterval>
  private resumeTimer?: ReturnType<typeof setTimeout>
  private getSettings: () => unknown = () => undefined
  private checkConnections?: (model: BackgroundTaskActivity['model']) => Promise<ConnectionReport>
  private suspended = false

  start(getSettings: () => unknown, checkConnections: NonNullable<BackgroundTaskService['checkConnections']>): void {
    if (this.watchdog) return
    this.getSettings = getSettings
    this.checkConnections = checkConnections
    this.suspended = false
    this.watchdog = setInterval(() => this.refresh(), 15_000)
    this.watchdog.unref()
    powerMonitor.on('suspend', this.onSuspend)
    powerMonitor.on('resume', this.onResume)
  }

  private register(window: BrowserWindow): WindowActivity {
    const existing = this.records.get(window.id)
    if (existing) return existing
    const contents = window.webContents
    const clear = (closed = false) => {
      const record = this.records.get(window.id)
      if (record) {
        record.activity = { state: 'idle' }
        record.updatedAt = 0
        record.connections = { checking: false, report: null }
        // In-flight checks retain the old record and cannot publish after navigation.
        this.records.delete(window.id)
        record.dispose()
        if (!closed && !window.isDestroyed()) window.setProgressBar(-1)
        this.refresh()
      }
    }
    const closed = () => clear(true)
    const crashed = () => clear()
    const navigation = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (details.isMainFrame && !details.isSameDocument) clear()
    }
    const record: WindowActivity = {
      window, activity: { state: 'idle' }, updatedAt: 0,
      connections: { checking: false, report: null }, modelRevision: 0,
      dispose: () => {
        window.removeListener('closed', closed)
        if (!contents.isDestroyed()) {
          contents.removeListener('render-process-gone', crashed)
          contents.removeListener('did-start-navigation', navigation)
        }
      },
    }
    window.once('closed', closed)
    contents.on('render-process-gone', crashed)
    contents.on('did-start-navigation', navigation)
    this.records.set(window.id, record)
    return record
  }

  update(window: BrowserWindow, activity: BackgroundTaskActivity): void {
    if (!this.watchdog || window.isDestroyed()) return
    const record = this.register(window)
    if (JSON.stringify(record.activity.model) !== JSON.stringify(activity.model)) {
      record.modelRevision++
      record.pendingCheck = undefined
      record.connections = { checking: false, report: null }
      this.send(record, 'backgroundTasks:connections', record.connections)
    }
    record.activity = activity
    record.updatedAt = Date.now()
    this.refresh()
  }

  refresh(): void {
    const settings = normalizeBackgroundTaskSettings(this.getSettings())
    let running = false
    for (const record of this.records.values()) {
      if (record.window.isDestroyed()) continue
      const fresh = !this.suspended && Date.now() - record.updatedAt < 60_000
      const state = fresh ? record.activity.state : 'idle'
      running ||= state === 'running'
      const mode = !settings.taskbarProgress || state === 'idle' ? 'none'
        : state === 'running' ? (record.activity.progress === undefined ? 'indeterminate' : 'normal') : state
      const progress = mode === 'none' ? -1 : mode === 'indeterminate' ? 2 : record.activity.progress ?? 1
      const presentation = `${mode}:${progress}`
      if (presentation !== record.presentation) {
        record.window.setProgressBar(progress, { mode })
        record.presentation = presentation
      }
    }
    if (running && settings.preventIdleSleep) {
      if (this.blockerId === undefined) this.blockerId = powerSaveBlocker.start('prevent-app-suspension')
    } else {
      this.releaseBlocker()
    }
  }

  private releaseBlocker(): void {
    if (this.blockerId !== undefined) {
      powerSaveBlocker.stop(this.blockerId)
      this.blockerId = undefined
    }
  }

  getConnections(window: BrowserWindow): BackgroundConnectionState {
    return this.records.get(window.id)?.connections ?? { checking: false, report: null }
  }

  async check(window: BrowserWindow): Promise<BackgroundConnectionState> {
    if (!this.watchdog || !this.checkConnections || window.isDestroyed()) return { checking: false, report: null }
    const record = this.register(window)
    if (record.pendingCheck) return record.pendingCheck
    record.connections = { ...record.connections, checking: true }
    this.send(record, 'backgroundTasks:connections', record.connections)
    const revision = record.modelRevision
    record.pendingCheck = this.checkConnections(record.activity.model).catch((): ConnectionReport => ({
      checkedAt: Date.now(), model: 'unconfigured', mcp: { checked: 0, failed: [] }, checkFailed: true,
    })).then(report => {
      if (revision !== record.modelRevision) return record.connections
      record.connections = { checking: false, report }
      if (this.records.get(window.id) === record) this.send(record, 'backgroundTasks:connections', record.connections)
      return record.connections
    }).finally(() => { if (revision === record.modelRevision) record.pendingCheck = undefined })
    return record.pendingCheck
  }

  private send(record: WindowActivity, channel: string, value?: unknown): void {
    if (!record.window.isDestroyed() && !record.window.webContents.isDestroyed()) record.window.webContents.send(channel, value)
  }

  private onSuspend = (): void => {
    this.suspended = true
    clearTimeout(this.resumeTimer)
    this.refresh()
  }

  private onResume = (): void => {
    this.suspended = false
    // Require a fresh renderer heartbeat before acquiring the blocker again.
    for (const record of this.records.values()) {
      record.updatedAt = 0
      this.send(record, 'backgroundTasks:resumed')
    }
    this.refresh()
    clearTimeout(this.resumeTimer)
    this.resumeTimer = setTimeout(() => {
      if (!normalizeBackgroundTaskSettings(this.getSettings()).checkConnectionsOnResume) return
      for (const record of this.records.values()) void this.check(record.window)
    }, 3000)
  }

  stop(): void {
    clearInterval(this.watchdog)
    this.watchdog = undefined
    clearTimeout(this.resumeTimer)
    powerMonitor.removeListener('suspend', this.onSuspend)
    powerMonitor.removeListener('resume', this.onResume)
    for (const record of this.records.values()) {
      record.dispose()
      if (!record.window.isDestroyed()) record.window.setProgressBar(-1)
    }
    this.records.clear()
    this.releaseBlocker()
  }
}

export const backgroundTaskService = new BackgroundTaskService()
