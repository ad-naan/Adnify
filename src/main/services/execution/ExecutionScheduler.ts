import { EXECUTION_LIMITS, type ExecutionUsage } from '@shared/types/execution'

export type ResourcePool = 'command' | 'background' | 'session'
export interface Admission { ownerId: number; threadId: string; pool: ResourcePool; usesExistingSession?: boolean; key?: string }
interface Waiter extends Admission {
  resolve: (release: () => void) => void
  reject: (error: Error) => void
  cleanup: () => void
}
export class ExecutionCapacityError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'ExecutionCapacityError' }
}

/** One admission ledger for every window. Reservations include starting/stopping processes. */
export class ExecutionScheduler {
  private active = new Set<Admission>()
  private queue: Waiter[] = []
  private lastOwner = new Map<ResourcePool, number>()
  private lastThread = new Map<number, string>()
  constructor(private limits: { [K in keyof typeof EXECUTION_LIMITS]: number } = EXECUTION_LIMITS) {}

  configure(limits: typeof this.limits): void {
    this.limits = { ...limits }
    // Lowering a budget never evicts a running process. Existing queue deadlines remain fixed.
    this.drain()
  }

  waitingReason(key: string): string | undefined {
    const item = this.queue.find(q => q.key === key)
    if (!item) return undefined
    const own = this.usage(item.ownerId)
    if (item.pool === 'session') return 'session_capacity'
    if (item.pool === 'background') {
      if (own.background >= this.limits.backgroundPerWindow) return 'window_background_capacity'
      if (this.usage().background >= this.limits.background) return 'background_capacity'
      return 'session_capacity'
    }
    if ([...this.active].filter(a => a.pool === 'command' && a.ownerId === item.ownerId && a.threadId === item.threadId).length >= this.limits.commandsPerThread) return 'thread_command_capacity'
    if (own.commands >= this.limits.commandsPerWindow) return 'window_command_capacity'
    return 'command_capacity'
  }

  usage(ownerId?: number): ExecutionUsage {
    const items = [...this.active].filter(a => ownerId === undefined || a.ownerId === ownerId)
    return {
      commands: items.filter(a => a.pool === 'command').length,
      background: items.filter(a => a.pool === 'background').length,
      sessions: items.filter(a => a.pool === 'session').length,
      queued: this.queue.filter(a => ownerId === undefined || a.ownerId === ownerId).length,
    }
  }

  acquire(admission: Admission, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new ExecutionCapacityError('cancelled'))
    if (this.queue.length >= this.limits.queued
      || this.queue.filter(q => q.ownerId === admission.ownerId).length >= this.limits.queuedPerWindow
      || this.queue.filter(q => q.ownerId === admission.ownerId && q.threadId === admission.threadId).length >= this.limits.queuedPerThread) {
      return Promise.reject(new ExecutionCapacityError('queue_full'))
    }
    return new Promise((resolve, reject) => {
      const remove = (code: string) => {
        const index = this.queue.indexOf(waiter)
        if (index < 0) return
        this.queue.splice(index, 1)
        waiter.cleanup()
        reject(new ExecutionCapacityError(code))
        this.drain()
      }
      const abort = () => remove('cancelled')
      const timer = setTimeout(() => remove('queue_expired'), this.limits.queueTimeoutMs)
      const waiter: Waiter = { ...admission, resolve, reject, cleanup: () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
      } }
      signal?.addEventListener('abort', abort, { once: true })
      this.queue.push(waiter)
      this.drain()
    })
  }

  transfer(key: string, ownerId: number): void {
    for (const item of [...this.active, ...this.queue]) if (item.key === key) item.ownerId = ownerId
    this.drain()
  }

  private canStart(item: Admission): boolean {
    const all = this.usage()
    const own = this.usage(item.ownerId)
    const persistent = [...this.active].filter(a => a.pool === 'session' || a.pool === 'background' && !a.usesExistingSession).length
    if (item.pool === 'session') return persistent < this.limits.persistent
    if (item.pool === 'background') return all.background < this.limits.background
      && own.background < this.limits.backgroundPerWindow
      && (item.usesExistingSession || persistent < this.limits.persistent)
    return all.commands < this.limits.commands && own.commands < this.limits.commandsPerWindow
      && [...this.active].filter(a => a.pool === 'command' && a.ownerId === item.ownerId
        && a.threadId === item.threadId).length < this.limits.commandsPerThread
  }

  private drain(): void {
    for (;;) {
      const eligible = this.queue.filter(item => this.canStart(item))
      if (!eligible.length) return
      // Rotate owners and threads within each pool; never put new requests ahead of queued work.
      const first = eligible[0]
      const samePool = eligible.filter(item => item.pool === first.pool)
      const owners = [...new Set(samePool.map(item => item.ownerId))]
      const previous = owners.indexOf(this.lastOwner.get(first.pool) ?? -1)
      const owner = owners[(previous + 1) % owners.length]
      const own = samePool.filter(item => item.ownerId === owner)
      const threads = [...new Set(own.map(item => item.threadId))]
      const previousThread = threads.indexOf(this.lastThread.get(owner) ?? '')
      const thread = threads[(previousThread + 1) % threads.length]
      const item = own.find(q => q.threadId === thread)!
      this.queue.splice(this.queue.indexOf(item), 1)
      item.cleanup()
      this.active.add(item)
      this.lastOwner.set(item.pool, owner)
      this.lastThread.set(owner, thread)
      let released = false
      item.resolve(() => {
        if (released) return
        released = true
        this.active.delete(item)
        this.drain()
      })
    }
  }
}
