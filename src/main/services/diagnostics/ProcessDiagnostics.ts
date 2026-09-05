import { app, BrowserWindow, webContents } from 'electron'
import * as v8 from 'node:v8'

interface ContentIdentity {
  webContentsId: number
  type: string
  windowId?: number
  hostWebContentsId?: number
}

export interface ProcessMemorySnapshot {
  sampledAt: number
  mainProcess: {
    pid: number
    heapUsedMB: number
    heapTotalMB: number
    heapLimitMB: number
    rssMB: number
    externalMB: number
  }
  processes: Array<{
    pid: number
    creationTime: number
    type: string
    serviceName?: string
    cpuPercent: number
    workingSetMB: number
    peakWorkingSetMB: number
    privateMB?: number
    contents: ContentIdentity[]
  }>
  unavailable?: true
}

const mb = (bytes: number) => Math.round(bytes / 1024 / 1024 * 10) / 10

/** OS process memory, including renderers, without requesting work from a hung page. */
export class ProcessDiagnostics {
  private history: ProcessMemorySnapshot[] = []
  private timer?: ReturnType<typeof setInterval>

  start(): void {
    if (this.timer) return
    this.sample()
    this.timer = setInterval(() => this.sample(), 30_000)
    this.timer.unref()
  }

  stop(): void {
    clearInterval(this.timer)
    this.timer = undefined
  }

  sample(): ProcessMemorySnapshot {
    const mem = process.memoryUsage()
    const snapshot: ProcessMemorySnapshot = {
      sampledAt: Date.now(),
      mainProcess: {
        pid: process.pid,
        heapUsedMB: mb(mem.heapUsed),
        heapTotalMB: mb(mem.heapTotal),
        heapLimitMB: mb(v8.getHeapStatistics().heap_size_limit),
        rssMB: mb(mem.rss),
        externalMB: mb(mem.external),
      },
      processes: [],
    }
    try {
      if (!app.isReady()) throw new Error('Application is not ready')
      const identities = new Map<number, ContentIdentity[]>()
      for (const contents of webContents.getAllWebContents()) {
        try {
          if (contents.isDestroyed()) continue
          const pid = contents.getOSProcessId()
          if (pid <= 0) continue
          const host = contents.hostWebContents
          const owner = BrowserWindow.fromWebContents(host ?? contents)
          const entries = identities.get(pid) ?? []
          entries.push({
            webContentsId: contents.id,
            type: contents.getType(),
            windowId: owner?.id,
            hostWebContentsId: host?.id,
          })
          identities.set(pid, entries)
        } catch { /* A page can disappear while processes are being enumerated. */ }
      }
      // Electron reports these memory values in KB. One row per PID prevents
      // counting a shared renderer once for every tab that uses it.
      snapshot.processes = app.getAppMetrics().map(metric => ({
        pid: metric.pid,
        creationTime: metric.creationTime,
        type: metric.type,
        serviceName: metric.serviceName,
        cpuPercent: metric.cpu.percentCPUUsage,
        workingSetMB: mb(metric.memory.workingSetSize * 1024),
        peakWorkingSetMB: mb(metric.memory.peakWorkingSetSize * 1024),
        ...(metric.memory.privateBytes === undefined ? {} : { privateMB: mb(metric.memory.privateBytes * 1024) }),
        contents: identities.get(metric.pid) ?? [],
      }))
    } catch {
      snapshot.unavailable = true
    }
    this.history.push(snapshot)
    if (this.history.length > 60) this.history.shift()
    return snapshot
  }

  getHistory(): ProcessMemorySnapshot[] {
    return [...this.history]
  }

  describeFailure(webContentsId?: number) {
    // Read the last matching sample BEFORE collecting again: the failed renderer
    // may already be missing, and its PID can later be reused by a new process.
    const previous = webContentsId === undefined
      ? this.history.at(-1)
      : [...this.history].reverse().find(sample => sample.processes.some(metric =>
        metric.contents.some(contents => contents.webContentsId === webContentsId)))
    return { previous, current: this.sample() }
  }
}

export const processDiagnostics = new ProcessDiagnostics()
