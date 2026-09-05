import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmbeddingService } from '@main/indexing/embedder'

const mock = vi.hoisted(() => ({ pipeline: vi.fn(), extractors: [] as Array<ReturnType<typeof vi.fn> & { dispose: ReturnType<typeof vi.fn> }> }))
vi.mock('@xenova/transformers', () => ({ pipeline: mock.pipeline, env: {} }))

beforeEach(async () => {
  await EmbeddingService.releaseLocalModel()
  mock.extractors.length = 0
  mock.pipeline.mockReset().mockImplementation(async (_task: string, model: string) => {
    const extractor = Object.assign(vi.fn(async () => ({ data: new Float32Array([model.endsWith('a') ? 1 : 2]) })), { dispose: vi.fn() })
    mock.extractors.push(extractor)
    return extractor
  })
})
afterEach(() => EmbeddingService.releaseLocalModel())
const service = (model: string) => new EmbeddingService({ provider: 'transformers', model: `Xenova/${model}`, cacheDir: 'fixture-cache' })

describe('local embedding model ownership', () => {
  it('shares model weights across batch/query services and releases the previous model on a switch', async () => {
    expect(await service('a').embedBatch(['one', 'two'])).toEqual([[1], [1]])
    expect(await service('a').embed('query')).toEqual([1])
    expect(mock.pipeline).toHaveBeenCalledTimes(1)
    expect(await service('b').embed('query')).toEqual([2])
    expect(mock.pipeline).toHaveBeenCalledTimes(2)
    expect(mock.extractors[0].dispose).toHaveBeenCalledTimes(1)
    await EmbeddingService.releaseLocalModel()
    expect(mock.extractors[1].dispose).toHaveBeenCalledTimes(1)
  })

  it('waits for active inference before disposing a model for a concurrent switch', async () => {
    const first = service('a')
    await first.embed('warmup')
    let release!: (value: { data: Float32Array }) => void
    mock.extractors[0].mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const running = first.embed('slow')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const switched = service('b').embed('next')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(mock.extractors[0].dispose).not.toHaveBeenCalled()
    release({ data: new Float32Array([3]) })
    expect(await running).toEqual([3])
    expect(await switched).toEqual([2])
    expect(mock.extractors[0].dispose).toHaveBeenCalledTimes(1)
  })
})
