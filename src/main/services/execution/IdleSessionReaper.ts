import { execFile } from 'node:child_process'
import type { InteractiveSessionRegistry } from './InteractiveSessionRegistry'
import type { ExecutionSettings } from '@shared/config/executionSettings'

/** Failure to inspect children is a reason to retain a shell, never permission to kill it. */
export function hasNoChildProcesses(pid: number): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return Promise.resolve(false)
  return new Promise(resolve => {
    if (process.platform === 'win32') {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${pid}').Count`],
      { windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024 }, (error, output) => resolve(!error && output.trim() === '0'))
    } else {
      execFile('ps', ['-eo', 'ppid='], { timeout: 5000, maxBuffer: 1024 * 1024 }, (error, output) =>
        resolve(!error && !output.trim().split(/\s+/).some(value => Number(value) === pid)))
    }
  })
}

export class IdleSessionReaper {
  private busy = false
  constructor(private readonly sessions: InteractiveSessionRegistry,
    private readonly settings: () => ExecutionSettings,
    private readonly idle: (id: string) => Promise<boolean>,
    private readonly stop: (id: string) => void) {}
  async sweep(pressure = false): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const config = this.settings()
      const candidates = this.sessions.list().filter(s => s.disposable && s.state === 'ready' && !s.userControlled && !s.remoteHost)
        .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
      const perOwner = new Map<number, number>()
      for (const [index, session] of candidates.entries()) {
        const count = (perOwner.get(session.ownerId) || 0) + 1
        perOwner.set(session.ownerId, count)
        if (!pressure && Date.now() - (session.lastUsedAt || 0) < config.idleTimeoutMs && index < config.idleGlobal && count <= config.idlePerWindow) continue
        if (await this.idle(session.id) && this.sessions.reclaim(session.id, session.revision)) this.stop(session.id)
        if (pressure) break // release one confirmed slot, then let the scheduler drain
      }
    } finally { this.busy = false }
  }
}
