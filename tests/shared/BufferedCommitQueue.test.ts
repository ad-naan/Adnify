import { describe, expect, it, vi } from 'vitest'
import { BufferedCommitQueue } from '@/shared/persistence/BufferedCommitQueue'

describe('BufferedCommitQueue', () => {
  it('coalesces staged values and serializes commits', async () => {
    vi.useFakeTimers()
    const committed: number[] = []
    const queue = new BufferedCommitQueue<number>({
      delayMs: 100,
      commit: async value => { committed.push(value) },
    })

    queue.stage(1)
    queue.stage(2)
    await vi.advanceTimersByTimeAsync(100)

    expect(committed).toEqual([2])
    vi.useRealTimers()
  })

  it('retains a failed value for an explicit retry', async () => {
    let attempts = 0
    const queue = new BufferedCommitQueue<string>({
      delayMs: 10_000,
      commit: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('disk unavailable')
      },
    })

    queue.stage('critical')
    await expect(queue.flush()).rejects.toThrow('disk unavailable')
    await expect(queue.flush()).resolves.toBeUndefined()
    expect(attempts).toBe(2)
  })
})
