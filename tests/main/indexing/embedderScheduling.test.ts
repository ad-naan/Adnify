import { describe, expect, it, vi } from 'vitest'
import { EmbeddingService } from '@main/indexing/embedder'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

describe('EmbeddingService scheduling', () => {
  it('serializes concurrent embedding batches and keeps the queue usable after failure', async () => {
    const service = new EmbeddingService({ provider: 'custom', model: 'test' })
    const first = deferred<number[][]>()
    const calls: string[][] = []
    const internals = service as unknown as {
      performEmbedBatch(texts: string[]): Promise<number[][]>
    }

    internals.performEmbedBatch = vi.fn(async texts => {
      calls.push(texts)
      if (calls.length === 1) return first.promise
      if (calls.length === 2) throw new Error('expected failure')
      return [[3]]
    })

    const firstRequest = service.embedBatch(['first'])
    const failedRequest = service.embedBatch(['second'])
    const finalRequest = service.embedBatch(['third'])
    await Promise.resolve()

    expect(calls).toEqual([['first']])
    first.resolve([[1]])

    await expect(firstRequest).resolves.toEqual([[1]])
    await expect(failedRequest).rejects.toThrow('expected failure')
    await expect(finalRequest).resolves.toEqual([[3]])
    expect(calls).toEqual([['first'], ['second'], ['third']])
  })
})
