export interface BufferedCommitQueueOptions<T> {
  delayMs: number
  commit: (value: T) => Promise<void>
  onBackgroundError?: (error: unknown) => void
}

/**
 * A latest-value, single-writer commit queue.
 *
 * Producers never wait on I/O. Repeated updates are coalesced, commits never
 * overlap, and an update arriving during a commit is drained before flush()
 * resolves. Failed values remain pending for an explicit retry.
 */
export class BufferedCommitQueue<T> {
  private pending: T | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private active: Promise<void> | null = null

  constructor(private readonly options: BufferedCommitQueueOptions<T>) {}

  stage(value: T): void {
    this.pending = value
    if (this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush().catch(error => this.options.onBackgroundError?.(error))
    }, this.options.delayMs)
  }

  flush(): Promise<void> {
    this.clearTimer()
    if (this.active) return this.active
    this.active = this.drain().finally(() => {
      this.active = null
    })
    return this.active
  }

  discard(): void {
    this.clearTimer()
    this.pending = null
  }

  hasPending(): boolean {
    return this.pending !== null || this.active !== null
  }

  private async drain(): Promise<void> {
    while (this.pending !== null) {
      const value = this.pending
      this.pending = null
      try {
        await this.options.commit(value)
      } catch (error) {
        if (this.pending === null) this.pending = value
        throw error
      }
    }
  }

  private clearTimer(): void {
    if (this.timer === null) return
    clearTimeout(this.timer)
    this.timer = null
  }
}
