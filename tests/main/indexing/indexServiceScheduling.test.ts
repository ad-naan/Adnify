import { beforeEach, describe, expect, it, vi } from 'vitest'

const workerState = vi.hoisted(() => ({
  instances: [] as Array<{
    postMessage: ReturnType<typeof vi.fn>
    emit: (event: string, value: unknown) => void
  }>,
}))

const structuralStoreState = vi.hoisted(() => ({
  operations: [] as Array<Record<string, unknown>>,
  loadBatches: [] as Array<Array<Record<string, unknown>>>,
  metadata: null as null | { totalFiles: number; totalChunks: number; savedAt: number },
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

vi.mock('@main/indexing/vectorStore', () => ({
  VectorStoreService: class {},
}))

vi.mock('@main/indexing/structuralIndexStore', () => ({
  StructuralIndexStore: class {
    async load(onBatch: (chunks: Array<Record<string, unknown>>) => void) {
      for (const batch of structuralStoreState.loadBatches) onBatch(batch)
      return structuralStoreState.metadata
    }

    async request(operation: Record<string, unknown>) {
      structuralStoreState.operations.push(operation)
      return { type: 'ok' }
    }

    async close() {}
  },
}))

vi.mock('@main/indexing/summary', () => ({
  ProjectSummaryGenerator: class {
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
    structuralStoreState.operations.length = 0
    structuralStoreState.loadBatches = []
    structuralStoreState.metadata = null
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
      ;(service as unknown as { status: { lastIndexedAt?: number } }).status.lastIndexedAt = 1
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

  it('fingerprints semantic data by provider, model and endpoint but not API key', () => {
    const internals = service as unknown as { embeddingFingerprint: string; semanticManifestValid: boolean }
    const initial = internals.embeddingFingerprint
    internals.semanticManifestValid = true

    service.updateEmbeddingConfig({ apiKey: 'rotated-secret' })
    expect(internals.embeddingFingerprint).toBe(initial)
    expect(internals.semanticManifestValid).toBe(true)

    service.updateEmbeddingConfig({ model: 'different-model' })
    expect(internals.embeddingFingerprint).not.toBe(initial)
    expect(internals.semanticManifestValid).toBe(false)
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
      requestId: 7,
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
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'structural_ack', requestId: 7 })
    expect(structuralStoreState.operations.map(operation => operation.type)).toEqual([
      'beginReplace',
      'appendReplace',
      'commitReplace',
    ])
  })

  it('rebuilds the in-memory search indexes from persisted batches', async () => {
    structuralStoreState.loadBatches = [[{
      id: 'cached-chunk',
      filePath: 'C:/workspace/src/cached.ts',
      relativePath: 'src/cached.ts',
      fileHash: 'hash',
      content: 'function cachedNeedle() {}',
      startLine: 1,
      endLine: 1,
      type: 'function',
      language: 'typescript',
      symbols: ['cachedNeedle'],
    }]]
    structuralStoreState.metadata = { totalFiles: 1, totalChunks: 1, savedAt: 123 }

    await service.initialize()

    expect(service.getStatus()).toMatchObject({
      totalFiles: 1,
      totalChunks: 1,
      lastIndexedAt: 123,
    })
    expect(service.searchSymbols('cachedNeedle')).toHaveLength(1)
    await expect(service.search('cachedNeedle')).resolves.toHaveLength(1)
  })

  it('processes structural watcher updates through the worker and persists them', async () => {
    structuralStoreState.metadata = { totalFiles: 1, totalChunks: 0, savedAt: 123 }
    await service.initialize()
    const updating = service.updateFiles(['C:/workspace/src/updated.ts'])
    await vi.waitFor(() => expect(workerState.instances).toHaveLength(1))
    const worker = workerState.instances[0]
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'batch_update',
      files: ['C:/workspace/src/updated.ts'],
      config: expect.objectContaining({ mode: 'structural' }),
    }))

    worker.emit('message', {
      type: 'batch_update_result',
      mode: 'structural',
      requestId: 1,
      results: [{
        filePath: 'C:/workspace/src/updated.ts',
        deleted: false,
        chunks: [{
          id: 'updated-chunk',
          filePath: 'C:/workspace/src/updated.ts',
          relativePath: 'src/updated.ts',
          fileHash: 'hash',
          content: 'function updatedNeedle() {}',
          startLine: 1,
          endLine: 1,
          type: 'function',
          language: 'typescript',
          symbols: ['updatedNeedle'],
        }],
      }],
    })

    await updating
    expect(service.searchSymbols('updatedNeedle')).toHaveLength(1)
    await expect(service.search('updatedNeedle')).resolves.toHaveLength(1)
    expect(structuralStoreState.operations.at(-1)).toMatchObject({
      type: 'applyFiles',
      files: [{ relativePath: 'src/updated.ts' }],
    })
  })

  it('does not create a partial index from watcher events before indexing is enabled', async () => {
    await service.updateFiles(['C:/workspace/src/updated.ts'])
    await service.deleteFileIndex('C:/workspace/src/deleted.ts')

    expect(workerState.instances).toHaveLength(0)
    expect(structuralStoreState.operations).toHaveLength(0)
  })

  it('finishes an active index with an error when the worker exits unexpectedly', async () => {
    const internals = service as unknown as { saveIndex(): Promise<void> }
    internals.saveIndex = vi.fn(async () => {})

    const indexing = service.indexWorkspace()
    await vi.waitFor(() => expect(workerState.instances).toHaveLength(1))
    workerState.instances[0].emit('exit', 1)

    await expect(indexing).rejects.toThrow('Index worker exited unexpectedly with code 1')
    expect(internals.saveIndex).not.toHaveBeenCalled()
    expect(service.getStatus()).toMatchObject({
      isIndexing: false,
      error: 'Index worker exited unexpectedly with code 1',
    })
  })

  // initialized 只在几个 await 之后才置位，而 8 个 IPC 处理器都以
  // `await indexService.initialize()` 开头，彼此没有互斥。两次并发加载会把
  // 每个符号留成两份，与全量构建交错时还会让构建方拿到 null 的符号表。
  it('shares one initialization across concurrent callers', async () => {
    const loading = deferred()
    let loads = 0
    const internals = service as unknown as { loadIndex(): Promise<void> }
    internals.loadIndex = vi.fn(async () => {
      loads += 1
      await loading.promise
    })

    const first = service.initialize()
    const second = service.initialize()
    await vi.waitFor(() => expect(loads).toBe(1))

    loading.resolve()
    await Promise.all([first, second])
    expect(loads).toBe(1)

    await service.initialize()
    expect(loads).toBe(1)
  })

  // 清空之后 lastIndexedAt 若还留着，updateFiles 会把随后任意一次文件保存
  // 当成增量更新放行，于是长出一个只含那一个文件、却自称完整的索引。
  it('clears the completed-index marker without publishing an empty manifest', async () => {
    const internals = service as unknown as { saveIndex(): Promise<void> }
    const saveIndex = vi.fn(async () => {})
    internals.saveIndex = saveIndex

    structuralStoreState.loadBatches = [[{
      id: 'cached-chunk',
      filePath: 'C:/workspace/src/cached.ts',
      relativePath: 'src/cached.ts',
      fileHash: 'hash',
      content: 'function cachedNeedle() {}',
      startLine: 1,
      endLine: 1,
      type: 'function',
      language: 'typescript',
      symbols: ['cachedNeedle'],
    }]]
    structuralStoreState.metadata = { totalFiles: 1, totalChunks: 1, savedAt: 123 }
    await service.initialize()
    expect(service.getStatus().lastIndexedAt).toBe(123)

    await service.clearIndex()

    expect(service.getStatus()).toMatchObject({ totalFiles: 0, indexedFiles: 0, totalChunks: 0 })
    expect(service.getStatus().lastIndexedAt).toBeUndefined()
    expect(saveIndex).not.toHaveBeenCalled()
    await expect(service.hasIndex()).resolves.toBe(false)

    await service.updateFiles(['C:/workspace/src/a.ts'])
    expect(workerState.instances).toHaveLength(0)
  })
})
