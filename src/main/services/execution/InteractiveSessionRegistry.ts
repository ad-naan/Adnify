import { randomUUID } from 'node:crypto'
import type { InteractiveSessionSnapshot } from '@shared/types/execution'
import { createShellIntegrationOscParser, parseShellIntegrationPayload } from '@shared/terminalShellIntegration'
import { normalizeExecutionSettings, type ExecutionSettings } from '@shared/config/executionSettings'
import { utf8Tail } from './ExecutionLogStore'

interface Session {
  ownerId: number
  snapshot: InteractiveSessionSnapshot
  parser: ReturnType<typeof createShellIntegrationOscParser>
  lease?: { id: string; submitted: boolean; started: boolean; release?: () => void; timer?: ReturnType<typeof setTimeout> }
}

export class InteractiveSessionRegistry {
  private sessions = new Map<string, Session>()
  private settings = normalizeExecutionSettings(undefined)
  otherOutputBytes: () => number = () => 0
  outputBytes(): number { return [...this.sessions.values()].reduce((sum, session) => sum + Buffer.byteLength(session.snapshot.output), 0) }
  configure(settings: ExecutionSettings): void {
    this.settings = settings
    for (const session of this.sessions.values()) session.snapshot.output = utf8Tail(session.snapshot.output, settings.outputBytes)
    this.trimLogs()
  }
  private trimLogs(): void {
    let total = this.outputBytes()
    const budget = Math.max(0, this.settings.memoryBytes - this.otherOutputBytes())
    for (const session of [...this.sessions.values()].sort((a, b) => (a.snapshot.lastUsedAt || 0) - (b.snapshot.lastUsedAt || 0))) {
      if (total <= budget) break
      const before = Buffer.byteLength(session.snapshot.output)
      session.snapshot.output = utf8Tail(session.snapshot.output, Math.max(0, before - (total - budget)))
      total -= before - Buffer.byteLength(session.snapshot.output)
    }
  }
  add(ownerId: number, spec: Pick<InteractiveSessionSnapshot, 'id' | 'cwd' | 'shell' | 'isAgent' | 'remoteHost'>): void {
    if (this.sessions.has(spec.id)) throw new Error('Session ID already exists')
    this.sessions.set(spec.id, { ownerId, parser: createShellIntegrationOscParser(), snapshot: {
      ...spec, state: 'starting', userControlled: !spec.isAgent, output: '', revision: 1, lastUsedAt: Date.now(), disposable: false,
    } })
  }
  private owned(ownerId: number, id: string): Session {
    const session = this.sessions.get(id)
    if (!session || session.ownerId !== ownerId) throw new Error('Terminal does not belong to this window')
    return session
  }
  claim(ownerId: number, id: string): string {
    const session = this.owned(ownerId, id)
    if (session.lease || session.snapshot.userControlled || !['starting', 'ready'].includes(session.snapshot.state)) {
      throw new Error('Terminal is busy, manually controlled, or its state is unknown')
    }
    const leaseId = randomUUID()
    session.lease = { id: leaseId, submitted: false, started: false }
    session.snapshot.disposable = false
    session.snapshot.lastUsedAt = Date.now()
    return leaseId
  }
  input(ownerId: number, id: string, leaseId?: string): void {
    const session = this.owned(ownerId, id)
    if (['exited', 'stopping'].includes(session.snapshot.state)) throw new Error('Terminal is not accepting input')
    if (leaseId) {
      if (session.lease?.id !== leaseId || session.lease.submitted) throw new Error('Invalid or already used terminal lease')
      session.lease.submitted = true
      clearTimeout(session.lease.timer)
    } else {
      session.snapshot.userControlled = true
      // Manual takeover does not mean the previous command stopped consuming resources.
    }
    session.snapshot.state = 'busy'
    session.snapshot.disposable = false
    session.snapshot.lastUsedAt = Date.now()
    session.snapshot.revision++
  }
  release(ownerId: number, id: string, leaseId: string): void {
    const session = this.owned(ownerId, id)
    if (session.lease?.id === leaseId && !session.lease.submitted) {
      session.lease.release?.()
      clearTimeout(session.lease.timer)
      session.lease = undefined
    }
  }
  attachPermit(ownerId: number, id: string, leaseId: string, release: () => void): void {
    const session = this.owned(ownerId, id)
    if (session.lease?.id !== leaseId || session.snapshot.state === 'stopping') { release(); throw new Error('Terminal lease was cancelled') }
    session.lease.release = release
    session.lease.timer = setTimeout(() => this.release(ownerId, id, leaseId), 30_000)
    session.lease.timer.unref?.()
  }
  output(id: string, data: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    const buffer = Buffer.from(session.snapshot.output + data)
    let start = Math.max(0, buffer.length - this.settings.outputBytes)
    while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start++
    session.snapshot.output = buffer.subarray(start).toString('utf8')
    session.snapshot.lastUsedAt = Date.now()
    for (const payload of session.parser.push(data)) {
      const event = parseShellIntegrationPayload(payload)
      if (!event || ['stopping', 'exited'].includes(session.snapshot.state)) continue
      if (event.phase === 'command-start') {
        session.snapshot.state = 'busy'
        if (session.lease?.submitted) session.lease.started = true
      }
      if (event.phase === 'command-end') {
        session.snapshot.state = 'ready'
        session.snapshot.exitCode = event.exitCode
        if (session.lease?.submitted && session.lease.started) {
          session.lease.release?.()
          session.lease = undefined
        }
      }
      if (event.phase === 'prompt') {
        session.snapshot.state = 'ready'
        if (session.lease?.submitted && session.lease.started) {
          session.lease.release?.()
          session.lease = undefined
        }
      }
    }
    session.snapshot.revision++
    this.trimLogs()
  }
  stopping(id: string): void {
    const session = this.sessions.get(id)
    if (session) { session.snapshot.state = 'stopping'; session.snapshot.revision++ }
  }
  error(id: string): void {
    const session = this.sessions.get(id)
    if (session) { session.snapshot.state = 'unknown'; session.snapshot.revision++ }
  }
  remove(id: string): void {
    const lease = this.sessions.get(id)?.lease
    clearTimeout(lease?.timer); lease?.release?.(); this.sessions.delete(id)
  }
  releaseUnsubmitted(ownerId: number): void {
    for (const [id, session] of this.sessions) if (session.ownerId === ownerId && session.lease && !session.lease.submitted) this.release(ownerId, id, session.lease.id)
  }
  setDisposable(ownerId: number, id: string, disposable: boolean): void {
    const session = this.owned(ownerId, id)
    if (disposable && (!session.snapshot.isAgent || session.snapshot.remoteHost || session.snapshot.userControlled || session.lease || session.snapshot.state !== 'ready')) throw new Error('Only a confirmed idle local Agent session can be recycled')
    session.snapshot.disposable = disposable
    session.snapshot.lastUsedAt = Date.now()
    session.snapshot.revision++
  }
  reclaim(id: string, revision: number): boolean {
    const session = this.sessions.get(id)
    if (!session || session.snapshot.revision !== revision || !session.snapshot.disposable || session.lease || session.snapshot.userControlled || session.snapshot.state !== 'ready') return false
    this.stopping(id)
    return true
  }
  list(ownerId?: number): (InteractiveSessionSnapshot & { ownerId: number })[] {
    return [...this.sessions.values()].filter(session => ownerId === undefined || session.ownerId === ownerId)
      .map(session => ({ ...session.snapshot, ownerId: session.ownerId }))
  }
}
