import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProcessMetric, WebContents } from 'electron'
import { app, webContents } from 'electron'
import { ProcessDiagnostics } from '@main/services/diagnostics/ProcessDiagnostics'

vi.mock('electron', () => ({
  app: { isReady: vi.fn(() => true), getAppMetrics: vi.fn(() => []) },
  webContents: { getAllWebContents: vi.fn(() => []) },
  BrowserWindow: { fromWebContents: vi.fn((contents: { id: number }) => ({ id: contents.id + 100 })) },
}))

const page = (id: number, pid: number, host?: WebContents) => ({
  id, hostWebContents: host, isDestroyed: () => false,
  getOSProcessId: () => pid, getType: () => host ? 'webview' : 'window',
}) as unknown as WebContents
const metric = (pid: number, creationTime = 1234) => ({
  pid, creationTime, type: 'Tab', cpu: { percentCPUUsage: 2 },
  memory: { workingSetSize: 102400, peakWorkingSetSize: 204800 },
}) as ProcessMetric

describe('process memory diagnostics', () => {
  let service: ProcessDiagnostics
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(app.isReady).mockReturnValue(true)
    vi.mocked(app.getAppMetrics).mockReturnValue([])
    vi.mocked(webContents.getAllWebContents).mockReturnValue([])
    service = new ProcessDiagnostics()
  })
  afterEach(() => { service.stop(); vi.useRealTimers() })

  it('converts Electron KB to MB and associates shared renderers without double counting', () => {
    const host = page(1, 10)
    vi.mocked(webContents.getAllWebContents).mockReturnValue([host, page(2, 20, host), page(3, 20, host)])
    vi.mocked(app.getAppMetrics).mockReturnValue([metric(10), metric(20)])
    const snapshot = service.sample()
    expect(snapshot.processes).toHaveLength(2)
    expect(snapshot.processes[1]).toMatchObject({ pid: 20, workingSetMB: 100, peakWorkingSetMB: 200,
      contents: [{ webContentsId: 2, windowId: 101, hostWebContentsId: 1 }, { webContentsId: 3, windowId: 101, hostWebContentsId: 1 }] })
    expect(snapshot.processes[1]).not.toHaveProperty('privateMB')
    expect(snapshot.mainProcess.pid).toBe(process.pid)
  })

  it('preserves the last sample from a crashed renderer when the PID is reused', () => {
    vi.mocked(webContents.getAllWebContents).mockReturnValue([page(1, 10)])
    vi.mocked(app.getAppMetrics).mockReturnValue([metric(10, 1000)])
    service.sample()
    vi.mocked(webContents.getAllWebContents).mockReturnValue([page(2, 10)])
    vi.mocked(app.getAppMetrics).mockReturnValue([metric(10, 2000)])
    const failure = service.describeFailure(1)
    expect(failure.previous?.processes[0].creationTime).toBe(1000)
    expect(failure.current.processes[0].creationTime).toBe(2000)
    expect(failure.current.processes[0].contents[0].webContentsId).toBe(2)
  })

  it('tolerates a page disappearing and reports unavailable metrics instead of zero memory', () => {
    const closed = page(1, 10)
    closed.getOSProcessId = () => { throw new Error('destroyed') }
    vi.mocked(webContents.getAllWebContents).mockReturnValue([closed, page(2, 20)])
    vi.mocked(app.getAppMetrics).mockReturnValue([metric(20)])
    expect(service.sample().processes[0].contents[0].webContentsId).toBe(2)
    vi.mocked(app.getAppMetrics).mockImplementationOnce(() => { throw new Error('unavailable') })
    expect(service.sample()).toMatchObject({ unavailable: true, processes: [] })
  })

  it('bounds history and stops periodic sampling on shutdown', () => {
    vi.useFakeTimers()
    service.start()
    service.start()
    vi.advanceTimersByTime(30_000 * 65)
    expect(service.getHistory()).toHaveLength(60)
    expect(app.getAppMetrics).toHaveBeenCalledTimes(66)
    service.stop()
    vi.advanceTimersByTime(60_000)
    expect(app.getAppMetrics).toHaveBeenCalledTimes(66)
  })

  it('does not invoke Electron metrics before app ready', () => {
    vi.mocked(app.isReady).mockReturnValue(false)
    expect(service.sample().unavailable).toBe(true)
    expect(app.getAppMetrics).not.toHaveBeenCalled()
  })
})
