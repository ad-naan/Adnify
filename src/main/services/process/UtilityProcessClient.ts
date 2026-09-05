import { app, session, utilityProcess, type UtilityProcess } from 'electron'
import { randomUUID } from 'node:crypto'

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  onEvent?: (event: unknown) => Promise<unknown>
}

const clients = new Set<UtilityProcessClient>()

/** Lazy, bounded RPC. A failed request is never replayed, especially a database write. */
export class UtilityProcessClient {
  private child?: UtilityProcess
  private starting?: Promise<UtilityProcess>
  private pending = new Map<string, Pending>()
  private idleTimer?: ReturnType<typeof setTimeout>
  private closed = false
  private closing?: Promise<void>
  private retired = new WeakSet<UtilityProcess>()

  constructor(private readonly options: {
    entry: string
    name: string
    timeoutMs?: number
    idleMs?: number
    network?: boolean
    onNotification?: (value: unknown) => void
    onExit?: (error: Error) => void
  }) { clients.add(this) }

  get pid(): number | undefined { return this.child?.pid }

  async request<T>(operation: unknown, options: { timeoutMs?: number; onEvent?: Pending['onEvent'] } = {}): Promise<T> {
    if (this.closed) throw new Error(`${this.options.name} has closed`)
    return this.invoke<T>(operation, options)
  }

  private async invoke<T>(operation: unknown, options: { timeoutMs?: number; onEvent?: Pending['onEvent']; shutdown?: boolean }): Promise<T> {
    clearTimeout(this.idleTimer)
    const child = await this.ensureProcess()
    if (this.closed && !options.shutdown) throw new Error(`${this.options.name} has closed`)
    if (this.pending.size >= 128) throw new Error(`${this.options.name} is busy`)
    const requestId = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        // A timed-out child could still be writing. Kill it before any later request
        // is allowed to reopen the same database; do not leave a zombie writer.
        this.fail(child, new Error(`${this.options.name} request timed out`), true)
      }, options.timeoutMs ?? this.options.timeoutMs ?? 30_000)
      this.pending.set(requestId, { resolve: value => resolve(value as T), reject, timer, onEvent: options.onEvent })
      try { child.postMessage({ requestId, operation }) }
      catch (error) { this.fail(child, error instanceof Error ? error : new Error(String(error)), true) }
    })
  }

  private ensureProcess(): Promise<UtilityProcess> {
    if (this.starting) return this.starting
    if (this.child?.pid) return Promise.resolve(this.child)
    if (!app.isReady()) return Promise.reject(new Error('Utility services require app readiness'))
    const child = utilityProcess.fork(this.options.entry, [], {
      serviceName: this.options.name,
      stdio: 'ignore',
      ...(this.options.network ? { session: session.defaultSession } : {}),
    })
    this.child = child
    this.starting = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${this.options.name} failed to start`))
        this.fail(child, new Error(`${this.options.name} startup timed out`), true)
      }, 10_000)
      child.once('spawn', () => {
        clearTimeout(timer)
        if (this.retired.has(child)) { child.kill(); reject(new Error(`${this.options.name} stopped during startup`)); return }
        this.starting = undefined
        resolve(child)
      })
      child.once('exit', code => {
        clearTimeout(timer)
        const error = new Error(`${this.options.name} exited (${code})`)
        reject(error)
        this.fail(child, error, false)
      })
    })
    child.on('message', (message: { requestId?: string; eventId?: string; event?: unknown; notification?: unknown; ok?: boolean; result?: unknown; error?: string }) => {
      if (child !== this.child || this.retired.has(child) || !message || typeof message !== 'object') return
      if ('notification' in message) { this.options.onNotification?.(message.notification); return }
      const pending = message.requestId && this.pending.get(message.requestId)
      if (!pending) return
      if (message.eventId) {
        const eventId = message.eventId
        void Promise.resolve().then(() => {
          if (!pending.onEvent) throw new Error('Unsupported utility callback')
          return pending.onEvent(message.event)
        }).then(result => {
          if (child === this.child && this.pending.has(message.requestId!)) child.postMessage({ eventId, ok: true, result })
        }, () => {
          if (child === this.child && this.pending.has(message.requestId!)) child.postMessage({ eventId, ok: false, error: 'Parent operation failed' })
        }).catch(() => {})
        return
      }
      this.pending.delete(message.requestId!)
      clearTimeout(pending.timer)
      if (message.ok) pending.resolve(message.result)
      else pending.reject(new Error(message.error || `${this.options.name} request failed`))
      this.scheduleIdle()
    })
    return this.starting
  }

  private fail(child: UtilityProcess, error: Error, kill: boolean): void {
    if (child !== this.child) return
    clearTimeout(this.idleTimer)
    // Keep the child attached until its exit. New work must not race a dying writer.
    const alreadyRetired = this.retired.has(child)
    this.retired.add(child)
    if (kill) {
      if (alreadyRetired) return
      this.starting = new Promise((_, reject) => child.once('exit', () => reject(error)))
      void this.starting.catch(() => {})
      child.kill()
    } else {
      this.child = undefined
      this.starting = undefined
    }
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this.pending.clear()
    if (!alreadyRetired) this.options.onExit?.(error)
  }

  private scheduleIdle(): void {
    if (!this.options.idleMs || this.pending.size || this.closed) return
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      if (this.child && !this.pending.size) this.fail(this.child, new Error(`${this.options.name} idle`), true)
    }, this.options.idleMs)
    this.idleTimer.unref()
  }

  close(operation?: unknown): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    clearTimeout(this.idleTimer)
    this.closing = (async () => {
      if (this.child && operation !== undefined) {
        try { await this.invoke(operation, { timeoutMs: 2500, shutdown: true }) } catch { /* Kill below if shutdown cannot drain. */ }
      }
      const child = this.child
      if (child) {
        const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
        this.fail(child, new Error(`${this.options.name} closed`), true)
        await Promise.race([exited, new Promise<void>(resolve => { const timer = setTimeout(resolve, 1000); timer.unref() })])
      }
      clients.delete(this)
    })()
    return this.closing
  }
}

export async function closeUtilityProcesses(): Promise<void> {
  await Promise.allSettled([...clients].map(client => client.close()))
}
