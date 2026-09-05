import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, powerMonitor, powerSaveBlocker } from 'electron'
import { BackgroundTaskService } from '@main/services/backgroundTasks/BackgroundTaskService'
import { DEFAULT_BACKGROUND_TASK_SETTINGS, type ConnectionReport } from '@shared/types/backgroundTasks'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { BrowserWindow: {}, powerMonitor: new EventEmitter(), powerSaveBlocker: { start: vi.fn(() => 0), stop: vi.fn() } }
})

function windowFixture(id: number) {
  const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: vi.fn() })
  return Object.assign(new EventEmitter(), { id, webContents: contents, isDestroyed: () => false, setProgressBar: vi.fn() })
}
const report: ConnectionReport = { checkedAt: 100, model: 'reachable', mcp: { checked: 0, failed: [] }, checkFailed: false }

describe('native background lifecycle', () => {
  let service: BackgroundTaskService
  let settings: typeof DEFAULT_BACKGROUND_TASK_SETTINGS
  let check: ReturnType<typeof vi.fn<() => Promise<ConnectionReport>>>
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-05T12:00:00Z'))
    vi.clearAllMocks()
    settings = { ...DEFAULT_BACKGROUND_TASK_SETTINGS }
    check = vi.fn(async () => report)
    service = new BackgroundTaskService()
    service.start(() => settings, check)
  })
  afterEach(() => { service.stop(); vi.useRealTimers() })

  it('defaults to no power blocker, then releases blocker ID zero on approval', () => {
    const win = windowFixture(1)
    service.update(win as unknown as BrowserWindow, { state: 'running' })
    expect(powerSaveBlocker.start).not.toHaveBeenCalled()
    expect(win.setProgressBar).toHaveBeenLastCalledWith(2, { mode: 'indeterminate' })
    settings.preventIdleSleep = true
    service.refresh()
    expect(powerSaveBlocker.start).toHaveBeenCalledWith('prevent-app-suspension')
    service.update(win as unknown as BrowserWindow, { state: 'paused', progress: 0.5 })
    expect(powerSaveBlocker.stop).toHaveBeenCalledWith(0)
    expect(win.setProgressBar).toHaveBeenLastCalledWith(0.5, { mode: 'paused' })
  })

  it('aggregates windows and immediately applies preference changes', () => {
    settings.preventIdleSleep = true
    const first = windowFixture(1), second = windowFixture(2)
    service.update(first as unknown as BrowserWindow, { state: 'running', progress: 0.4 })
    service.update(second as unknown as BrowserWindow, { state: 'running' })
    service.update(first as unknown as BrowserWindow, { state: 'idle' })
    expect(powerSaveBlocker.start).toHaveBeenCalledTimes(1)
    expect(powerSaveBlocker.stop).not.toHaveBeenCalled()
    settings.preventIdleSleep = false
    settings.taskbarProgress = false
    service.refresh()
    expect(powerSaveBlocker.stop).toHaveBeenCalledTimes(1)
    expect(second.setProgressBar).toHaveBeenLastCalledWith(-1, { mode: 'none' })
  })

  it.each(['closed', 'render-process-gone', 'navigation', 'expired', 'stop'])('clears stale work on %s', reason => {
    settings.preventIdleSleep = true
    const win = windowFixture(1)
    service.update(win as unknown as BrowserWindow, { state: 'running' })
    if (reason === 'closed') win.emit('closed')
    if (reason === 'render-process-gone') win.webContents.emit('render-process-gone')
    if (reason === 'navigation') win.webContents.emit('did-start-navigation', { isSameDocument: false, isMainFrame: true })
    if (reason === 'expired') vi.advanceTimersByTime(60_000)
    if (reason === 'stop') service.stop()
    expect(powerSaveBlocker.stop).toHaveBeenCalledTimes(1)
  })

  it('does not clear activity on an iframe or same-document navigation', () => {
    settings.preventIdleSleep = true
    const win = windowFixture(1)
    service.update(win as unknown as BrowserWindow, { state: 'running' })
    win.webContents.emit('did-start-navigation', { isSameDocument: false, isMainFrame: false })
    win.webContents.emit('did-start-navigation', { isSameDocument: true, isMainFrame: true })
    expect(powerSaveBlocker.stop).not.toHaveBeenCalled()
  })

  it('releases on suspend, requires fresh activity after wake and checks once after network settles', async () => {
    settings.preventIdleSleep = true
    const win = windowFixture(1)
    service.update(win as unknown as BrowserWindow, { state: 'running', model: { provider: 'test' } })
    powerMonitor.emit('suspend')
    expect(powerSaveBlocker.stop).toHaveBeenCalledWith(0)
    powerMonitor.emit('resume')
    expect(win.webContents.send).toHaveBeenCalledWith('backgroundTasks:resumed', undefined)
    expect(powerSaveBlocker.start).toHaveBeenCalledTimes(1)
    service.update(win as unknown as BrowserWindow, { state: 'running', model: { provider: 'test' } })
    expect(powerSaveBlocker.start).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2999)
    expect(check).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(check).toHaveBeenCalledWith({ provider: 'test' })
    expect(service.getConnections(win as unknown as BrowserWindow)).toEqual({ checking: false, report })
  })

  it('honors disabled resume checks and removes timers/listeners on stop', async () => {
    settings.checkConnectionsOnResume = false
    const win = windowFixture(1)
    service.update(win as unknown as BrowserWindow, { state: 'idle' })
    powerMonitor.emit('resume')
    await vi.advanceTimersByTimeAsync(3000)
    expect(check).not.toHaveBeenCalled()
    settings.checkConnectionsOnResume = true
    powerMonitor.emit('resume')
    service.stop()
    await vi.advanceTimersByTimeAsync(3000)
    expect(check).not.toHaveBeenCalled()
    expect(powerMonitor.listenerCount('resume')).toBe(0)
    expect(win.webContents.listenerCount('render-process-gone')).toBe(0)
  })

  it('coalesces concurrent checks and drops late results after navigation', async () => {
    let finish!: (value: ConnectionReport) => void
    check.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const win = windowFixture(1)
    const pending = service.check(win as unknown as BrowserWindow)
    const duplicate = service.check(win as unknown as BrowserWindow)
    expect(check).toHaveBeenCalledTimes(1)
    win.webContents.emit('did-start-navigation', { isSameDocument: false, isMainFrame: true })
    finish(report)
    await Promise.all([pending, duplicate])
    expect(win.webContents.send).not.toHaveBeenCalledWith('backgroundTasks:connections', { checking: false, report })
  })

  it('does not publish results for a model configuration that has changed', async () => {
    let finish!: (value: ConnectionReport) => void
    check.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const win = windowFixture(1)
    service.update(win as unknown as BrowserWindow, { state: 'idle', model: { provider: 'old' } })
    const pending = service.check(win as unknown as BrowserWindow)
    service.update(win as unknown as BrowserWindow, { state: 'idle', model: { provider: 'new' } })
    finish(report)
    await pending
    expect(service.getConnections(win as unknown as BrowserWindow)).toEqual({ checking: false, report: null })
    expect(win.webContents.send).not.toHaveBeenCalledWith('backgroundTasks:connections', { checking: false, report })
  })
})
