import { randomUUID } from 'node:crypto'
import { EXECUTION_LIMITS, isExecutionFinished, type ExecutionRequest, type ExecutionSnapshot } from '@shared/types/execution'
import { ExecutionScheduler, ExecutionCapacityError } from './ExecutionScheduler'
import { startExecutionProcess, type ProcessHandle, type ProcessSpec } from './ProcessRunner'

interface Job {
  ownerId: number
  consumers: Set<number>
  snapshot: ExecutionSnapshot
  spec: ExecutionRequest & { cwd: string; shell: string; workspaceId?: string }
  abort: AbortController
  process?: ProcessHandle
  listeners: Set<() => void>
  emitTimer?: ReturnType<typeof setTimeout>
  timeout?: ReturnType<typeof setTimeout>
  stopWatchdog?: ReturnType<typeof setTimeout>
}
type Runner = (spec: ProcessSpec, output: (data: string) => void) => ProcessHandle

/** Process lifetime is independent of a renderer's request, view, or wait timeout. */
export class ExecutionService {
  private jobs = new Map<string, Job>()
  private requests = new Map<string, { jobId: string; signature: string; acceptedAt: number }>()
  private closedOwners = new Set<number>()
  private shuttingDown = false
  constructor(
    readonly scheduler = new ExecutionScheduler(),
    private readonly emit: (ownerId: number, snapshot: ExecutionSnapshot) => void = () => {},
    private readonly runner: Runner = startExecutionProcess,
  ) {}

  private requestId(ownerId: number, key: string) { return `${ownerId}:${key}` }

  lookup(ownerId: number, requestKey: string): ExecutionSnapshot | undefined {
    const request = this.requests.get(this.requestId(ownerId, requestKey))
    const job = request ? this.jobs.get(request.jobId) : undefined
    return job ? this.snapshot(job) : undefined
  }

  submit(ownerId: number, spec: ExecutionRequest & { cwd: string; shell: string; workspaceId?: string }): ExecutionSnapshot {
    const signature = JSON.stringify([spec.command, spec.cwd, spec.shell, spec.mode, spec.threadId, spec.serviceKey, spec.timeoutMs])
    const existing = this.lookup(ownerId, spec.requestKey)
    if (existing) {
      if (this.requests.get(this.requestId(ownerId, spec.requestKey))!.signature !== signature) throw new Error('request_conflict')
      return existing
    }
    const issuedAt = Number(spec.requestKey.split(':', 1)[0])
    if (!Number.isFinite(issuedAt) || issuedAt > Date.now() + 60_000 || Date.now() - issuedAt > 30 * 60_000) {
      throw new Error('request_expired')
    }
    this.pruneHistory()
    if (this.shuttingDown || this.closedOwners.has(ownerId)) throw new Error('owner_closed')
    if (spec.serviceKey) {
      const service = [...this.jobs.values()].find(job => (spec.workspaceId ? job.spec.workspaceId === spec.workspaceId : job.ownerId === ownerId)
        && job.spec.serviceKey === spec.serviceKey && !isExecutionFinished(job.snapshot.status))
      if (service) {
        if (service.spec.command !== spec.command || service.spec.cwd !== spec.cwd || service.spec.shell !== spec.shell) {
          throw new Error('service_conflict')
        }
        this.requests.set(this.requestId(ownerId, spec.requestKey), { jobId: service.snapshot.jobId, signature, acceptedAt: Date.now() })
        service.consumers.add(ownerId)
        service.snapshot.consumers = service.consumers.size
        this.changed(service)
        return this.snapshot(service)
      }
    }
    // Bound metadata as well as logs. Never evict a live job or forget an accepted request key.
    if (this.jobs.size >= 10_000) throw new Error('execution_history_full')
    const job: Job = {
      ownerId, consumers: new Set([ownerId]), spec, abort: new AbortController(), listeners: new Set(),
      snapshot: {
        jobId: randomUUID(), requestKey: spec.requestKey, threadId: spec.threadId,
        command: spec.command, cwd: spec.cwd, shell: spec.shell, mode: spec.mode,
        status: 'queued', submittedAt: Date.now(), exitCode: null, output: '', truncated: false, revision: 1,
      },
    }
    this.jobs.set(job.snapshot.jobId, job)
    this.requests.set(this.requestId(ownerId, spec.requestKey), { jobId: job.snapshot.jobId, signature, acceptedAt: Date.now() })
    void this.run(job)
    return this.snapshot(job)
  }

  private snapshot(job: Job): ExecutionSnapshot { return { ...job.snapshot } }
  private owned(ownerId: number, id: string): Job {
    const job = this.jobs.get(id)
    if (!job || !job.consumers.has(ownerId)) throw new Error('job_not_found')
    return job
  }
  list(ownerId: number): ExecutionSnapshot[] {
    const own = [...this.jobs.values()].filter(job => job.consumers.has(ownerId))
    return own.filter(job => !isExecutionFinished(job.snapshot.status))
      .concat(own.filter(job => isExecutionFinished(job.snapshot.status)).slice(-EXECUTION_LIMITS.history))
      .map(job => this.snapshot(job))
  }
  get(ownerId: number, id: string) { return this.snapshot(this.owned(ownerId, id)) }

  wait(ownerId: number, id: string, afterRevision: number, waitMs: number): Promise<ExecutionSnapshot> {
    const job = this.owned(ownerId, id)
    if (job.snapshot.revision > afterRevision || isExecutionFinished(job.snapshot.status)) return Promise.resolve(this.snapshot(job))
    return new Promise(resolve => {
      const finish = () => { clearTimeout(timer); job.listeners.delete(finish); resolve(this.snapshot(job)) }
      const timer = setTimeout(finish, Math.max(0, Math.min(waitMs, 30_000)))
      job.listeners.add(finish)
    })
  }

  cancel(ownerId: number, id: string, reason = 'cancelled'): ExecutionSnapshot {
    const job = this.owned(ownerId, id)
    if (isExecutionFinished(job.snapshot.status)) return this.snapshot(job)
    job.snapshot.reason = reason
    if (!job.process) {
      job.abort.abort()
    } else if (job.snapshot.status !== 'stopping') {
      job.snapshot.status = 'stopping'
      clearTimeout(job.timeout)
      this.changed(job)
      const failed = () => {
        if (isExecutionFinished(job.snapshot.status)) return
        job.snapshot.status = 'unknown'; job.snapshot.reason = 'stop_failed'; this.changed(job)
      }
      try { void Promise.resolve(job.process.stop()).catch(failed) } catch { failed() }
      job.stopWatchdog = setTimeout(() => {
        if (job.snapshot.status === 'stopping') {
          job.snapshot.status = 'unknown'
          job.snapshot.reason = 'stop_failed'
          this.changed(job)
        }
      }, 10_000)
      job.stopWatchdog.unref?.()
    }
    return this.snapshot(job)
  }

  input(ownerId: number, id: string, data: string): void {
    const job = this.owned(ownerId, id)
    if (data === '\x03') { this.cancel(ownerId, id); return }
    if (!job.process || job.snapshot.status !== 'running') throw new Error('job_not_running')
    job.process.input(data)
  }

  closeOwner(ownerId: number): void {
    this.closedOwners.add(ownerId)
    for (const job of this.jobs.values()) {
      if (!job.consumers.has(ownerId)) continue
      if (job.consumers.size > 1) {
        job.consumers.delete(ownerId)
        job.snapshot.consumers = job.consumers.size
        if (job.ownerId === ownerId) {
          job.ownerId = [...job.consumers][0]
          this.scheduler.transfer(job.snapshot.jobId, job.ownerId)
        }
        this.changed(job)
      } else if (!isExecutionFinished(job.snapshot.status)) this.cancel(ownerId, job.snapshot.jobId, 'window_closed')
    }
  }
  shutdown(): void {
    this.shuttingDown = true
    for (const job of this.jobs.values()) {
      if (!isExecutionFinished(job.snapshot.status)) this.cancel(job.ownerId, job.snapshot.jobId, 'application_closed')
    }
  }

  private pruneHistory(): void {
    const cutoff = Date.now() - 30 * 60_000
    for (const [key, request] of this.requests) {
      if (request.acceptedAt < cutoff && isExecutionFinished(this.jobs.get(request.jobId)?.snapshot.status || 'unknown')) this.requests.delete(key)
    }
    const protectedIds = new Set([...this.requests.values()].map(request => request.jobId))
    const recent = new Set([...this.jobs.values()].filter(job => isExecutionFinished(job.snapshot.status))
      .slice(-EXECUTION_LIMITS.history).map(job => job.snapshot.jobId))
    for (const [id, job] of this.jobs) {
      if (isExecutionFinished(job.snapshot.status) && !protectedIds.has(id) && !recent.has(id)) this.jobs.delete(id)
    }
  }

  private changed(job: Job, outputOnly = false): void {
    job.snapshot.revision++
    if (outputOnly && job.emitTimer) return
    const publish = () => {
      job.emitTimer = undefined
      for (const ownerId of job.consumers) {
        try { this.emit(ownerId, this.snapshot(job)) } catch { /* renderer may be offline */ }
      }
      if (!outputOnly) for (const listener of [...job.listeners]) listener()
    }
    if (outputOnly) job.emitTimer = setTimeout(publish, 50)
    else { clearTimeout(job.emitTimer); publish() }
  }

  private output(job: Job, text: string): void {
    if (!text) return
    const bytes = Buffer.from(job.snapshot.output + text)
    if (bytes.length > EXECUTION_LIMITS.outputBytes) {
      let start = bytes.length - EXECUTION_LIMITS.outputBytes
      while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++
      job.snapshot.output = bytes.subarray(start).toString('utf8')
      job.snapshot.truncated = true
    } else job.snapshot.output += text
    this.trimLogs()
    this.changed(job, true)
  }

  private trimLogs(): void {
    const ordered = [...this.jobs.values()].sort((a, b) =>
      Number(!isExecutionFinished(a.snapshot.status)) - Number(!isExecutionFinished(b.snapshot.status))
      || a.snapshot.submittedAt - b.snapshot.submittedAt)
    let total = ordered.reduce((sum, job) => sum + Buffer.byteLength(job.snapshot.output), 0)
    for (const job of ordered) {
      if (total <= 16 * 1024 * 1024) break
      const size = Buffer.byteLength(job.snapshot.output)
      if (!size) continue
      total -= size
      job.snapshot.output = ''
      job.snapshot.truncated = true
      this.changed(job, true)
    }
  }

  private async run(job: Job): Promise<void> {
    let release: (() => void) | undefined
    try {
      release = await this.scheduler.acquire({ ownerId: job.ownerId, threadId: job.spec.threadId, pool: job.spec.mode, key: job.snapshot.jobId }, job.abort.signal)
      if (job.abort.signal.aborted) throw new ExecutionCapacityError('cancelled')
      job.snapshot.status = 'starting'
      this.changed(job)
      job.process = this.runner(job.spec, text => this.output(job, text))
      job.snapshot.status = 'running'
      job.snapshot.startedAt = Date.now()
      this.changed(job)
      if (job.spec.mode === 'command') {
        job.timeout = setTimeout(() => this.cancel(job.ownerId, job.snapshot.jobId, 'execution_timeout'), job.spec.timeoutMs ?? 120_000)
      }
      const outcome = await job.process.done
      // Only the backend's close result can release this permit, including after stop_failed.
      clearTimeout(job.timeout)
      clearTimeout(job.stopWatchdog)
      job.snapshot.exitCode = outcome.exitCode
      job.snapshot.signal = outcome.signal
      job.snapshot.status = job.snapshot.reason ? 'cancelled' : outcome.exitCode === 0 ? 'completed' : 'failed'
      if (outcome.error) job.snapshot.reason = outcome.error
    } catch (error) {
      job.snapshot.status = job.abort.signal.aborted ? 'cancelled' : error instanceof ExecutionCapacityError ? 'expired' : 'failed'
      job.snapshot.reason = error instanceof Error ? error.message : String(error)
    } finally {
      release?.()
      job.snapshot.endedAt = Date.now()
      this.changed(job)
    }
  }
}
