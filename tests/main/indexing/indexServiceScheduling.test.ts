import { beforeEach, describe, expect, it, vi } from 'vitest'

const workerState = vi.hoisted(() => ({
  instances: [] as Array<{
    postMessage: ReturnType<typeof vi.fn>
    emit: (event: string, value: unknown) => void
  }>,
}))

vi.mock('worker_threads', () => ({
  Worker: class {
    private listeners = new Map<string, Array<(value: unknown) => void>>()
    postMessage = vi.fn()
    terminate = vi.fn()

    constructor() {
      workerState.instances.push(this)
    }

    on(event: string, listener: (value: unknown) => void): this {
      const listeners = this.listeners.get(event) || []
      listeners.push(listener)
      this.listeners.set(event, listeners)
      return this
    }

    emit(event: string, value: unknown): void {
      for (const listener of this.listeners.get(event) || []) listener(value)
    }
  },
}))

vi.mock('@main/indexing/treeSitterChunker', () => ({
  TreeSitterChunker: class {
    init = vi.fn(async () => {})
  },
}))

vi.mock('@main/indexing/vectorStore', () => ({
  VectorStoreService: class {},
}))

vi.mock('@main/indexing/summary', () => ({
  ProjectSummaryGenerator: class {
    loadCache = vi.fn(async () => null)
    generate = vi.fn(() => ({
      name: 'workspace',
      structure: [],
      keyFiles: [],
      totalFiles: 1,
      totalSymbols: 1,
      languages: { typescript: 1 },
      generatedAt: 1,
    }))
  },
}))

vi.mock('@main/services/configPath', () => ({
  getUserConfigDir: () => 'C:/adnify-test',
  getWorkspaceCacheDir: () => 'C:/adnify-test/cache',
}))

import { CodebaseIndexService } from '@main/indexing/indexService'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}

describe('CodebaseIndexService scheduling', () => {
  let service: CodebaseIndexService

  beforeEach(() => {
    workerState.instances.length = 0
    service = new CodebaseIndexService('C:/workspace')
  })

  it('runs watcher mutations after an active full index', async () => {
    const fullIndex = deferred()
    const order: string[] = []
    const internals = service as unknown as {
      performWorkspaceIndex(): Promise<void>
      performUpdateFiles(paths: string[]): Promise<void>
    }

    internals.performWorkspaceIndex = vi.fn(async () => {
      order.push('index:start')
      await fullIndex.promise
      order.push('index:end')
    })
    internals.performUpdateFiles = vi.fn(async paths => {
      order.push(`update:${paths.join(',')}`)
    })

    const indexing = service.indexWorkspace()
    await vi.waitFor(() => expect(order).toEqual(['index:start']))
    const updating = service.updateFiles(['a.ts', 'b.ts'])
    await Promise.resolve()

    expect(order).toEqual(['index:start'])
    fullIndex.resolve()
    await Promise.all([indexing, updating])
    expect(order).toEqual(['index:start', 'index:end', 'update:a.ts,b.ts'])
  })

  it('deduplicates concurrent full-index requests', async () => {
    const active = deferred()
    const internals = service as unknown as { performWorkspaceIndex(): Promise<void> }
    const perform = vi.fn(async () => active.promise)
    internals.performWorkspaceIndex = perform

    const first = service.indexWorkspace()
    const second = service.indexWorkspace()
    await vi.waitFor(() => expect(perform).toHaveBeenCalledTimes(1))

    active.resolve()
    await Promise.all([first, second])
    expect(perform).toHaveBeenCalledTimes(1)
  })

  it('builds the structural index from worker batches', async () => {
    const internals = service as unknown as { saveIndex(): Promise<void> }
    internals.saveIndex = vi.fn(async () => {})

    const indexing = service.indexWorkspace()
    await vi.waitFor(() => expect(workerState.instances).toHaveLength(1))
    const worker = workerState.instances[0]
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'index',
      workspacePath: 'C:/workspace',
      config: expect.objectContaining({ mode: 'structural' }),
    }))

    worker.emit('message', {
      type: 'structural_result',
      processed: 1,
      total: 1,
      chunks: [{
        id: 'chunk-1',
        filePath: 'C:/workspace/src/example.ts',
        relativePath: 'src/example.ts',
        fileHash: 'hash',
        content: 'function needle() {}',
        startLine: 1,
        endLine: 1,
        type: 'function',
        language: 'typescript',
        symbols: ['needle'],
      }],
    })
    worker.emit('message', { type: 'complete', totalChunks: 1 })

    await indexing
    expect(service.getStatus()).toMatchObject({
      isIndexing: false,
      indexedFiles: 1,
      totalFiles: 1,
      totalChunks: 1,
    })
    expect(service.searchSymbols('needle')).toHaveLength(1)
    await expect(service.search('needle')).resolves.toHaveLength(1)
  })

  it('finishes an active index with an error when the worker exits unexpectedly', async () => {
    const internals = service as unknown as { saveIndex(): Promise<void> }
    internals.saveIndex = vi.fn(async () => {})

    const indexing = service.indexWorkspace()
    await vi.waitFor(() => expect(workerState.instances).toHaveLength(1))
    workerState.instances[0].emit('exit', 1)

    await indexing
    expect(service.getStatus()).toMatchObject({
      isIndexing: false,
      error: 'Index worker exited unexpectedly with code 1',
    })
  })
})
