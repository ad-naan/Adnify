/**
 * 代码库索引服务
 * 支持两种模式：
 * - structural: 结构化索引（默认），基于 Tree-sitter + BM25，零配置
 * - semantic: 语义索引，基于 Embedding + 向量搜索，需要 API
 */

import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import { Worker } from 'worker_threads'
import { logger, normalizePath } from '@shared/utils'
import { EmbeddingService } from './embedder'
import { VectorStoreService } from './vectorStore'
import { BM25Index, SymbolIndex, rerankCandidates } from './search'
import { ProjectSummaryGenerator } from './summary'
import { StructuralIndexStore } from './structuralIndexStore'
import {
  IndexConfig, IndexStatus, IndexMode, SearchResult,
  EmbeddingConfig, ProjectSummary, SymbolInfo, CodeChunk, IndexedChunk,
  DEFAULT_INDEX_CONFIG,
} from './types'
import { getUserConfigDir, getWorkspaceCacheDir } from '../services/configPath'

// Worker 消息类型
interface WorkerStructuralResultMessage { type: 'structural_result'; requestId: number; chunks: CodeChunk[]; processed: number; total: number }
interface WorkerResultMessage { type: 'result'; chunks: IndexedChunk[]; processed: number; total: number }
interface WorkerUpdateResultMessage { type: 'update_result'; filePath: string; chunks: IndexedChunk[]; deleted: boolean }
type WorkerBatchUpdateResultMessage =
  | {
      type: 'batch_update_result'
      mode: 'structural'
      requestId: number
      results: Array<{ filePath: string; chunks: CodeChunk[]; deleted: boolean }>
    }
  | {
      type: 'batch_update_result'
      mode: 'semantic'
      requestId: number
      results: Array<{ filePath: string; chunks: IndexedChunk[]; deleted: boolean }>
    }
interface WorkerCompleteMessage { type: 'complete'; totalChunks: number }
interface WorkerErrorMessage { type: 'error'; error: string; requestId?: number }
type WorkerMessage =
  | { type: 'progress'; processed: number; total: number; message?: string }
  | WorkerStructuralResultMessage
  | WorkerResultMessage
  | WorkerUpdateResultMessage
  | WorkerBatchUpdateResultMessage
  | WorkerCompleteMessage
  | WorkerErrorMessage

export class CodebaseIndexService {

  private workspacePath: string
  private workspaceCachePath: string
  private config: IndexConfig
  private mainWindow: BrowserWindow | null = null

  // 结构化索引组件
  private bm25Index: BM25Index
  private symbolIndex: SymbolIndex
  private summaryGenerator: ProjectSummaryGenerator
  private projectSummary: ProjectSummary | null = null

  // 语义索引组件（按需初始化）
  private embedder: EmbeddingService | null = null
  private vectorStore: VectorStoreService | null = null
  private worker: Worker | null = null
  private pendingIndexResolve: (() => void) | null = null
  private pendingIndexReject: ((err: Error) => void) | null = null
  private workerMessageQueue = Promise.resolve()
  private nextWorkerRequestId = 1
  private pendingWorkerUpdates = new Map<number, { resolve: () => void; reject: (error: Error) => void }>()
  private destroyed = false
  private mutationQueue = Promise.resolve()
  private pendingFullIndex: Promise<void> | null = null
  private structuralBuildLanguages: Record<string, number> | null = null
  private structuralBuildFileSymbols: Map<string, SymbolInfo[]> | null = null
  private structuralBuildGeneration: string | null = null
  private structuralStore: StructuralIndexStore

  private status: IndexStatus = {
    mode: 'structural',
    isIndexing: false,
    totalFiles: 0,
    indexedFiles: 0,
    totalChunks: 0,
  }

  private lastProgressEmit = 0
  private readonly PROGRESS_THROTTLE_MS = 100

  constructor(workspacePath: string, config?: Partial<IndexConfig>) {
    this.workspacePath = workspacePath
    this.workspaceCachePath = getWorkspaceCacheDir(workspacePath)
    this.config = { ...DEFAULT_INDEX_CONFIG, ...config }
    // 注入缓存路径（用于 Worker 中的 Transformers.js）
    if (!this.config.embedding.cacheDir) {
      this.config.embedding.cacheDir = path.join(getUserConfigDir(), 'models')
    }
    this.status.mode = this.config.mode

    // 初始化结构化索引组件
    this.bm25Index = new BM25Index()
    this.symbolIndex = new SymbolIndex()
    this.summaryGenerator = new ProjectSummaryGenerator(
      workspacePath,
      path.join(this.workspaceCachePath, 'project-summary.json'),
    )
    this.structuralStore = new StructuralIndexStore(this.structuralIndexPath)
  }

  // ==================== 公共 API ====================

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  private get structuralIndexPath(): string {
    return path.join(this.workspaceCachePath, 'structural-index.sqlite')
  }

  private get legacyStructuralIndexPath(): string {
    return path.join(this.workspaceCachePath, 'structural-index.json')
  }

  private get indexStatusPath(): string {
    return path.join(this.workspaceCachePath, 'index-status.json')
  }

  private initialized = false

  async initialize(): Promise<void> {
    if (this.initialized) return
    if (this.destroyed) throw new Error('Index service has been destroyed')

    // 加载缓存的项目摘要
    this.projectSummary = await this.summaryGenerator.loadCache()

    // 加载索引状态和结构化索引
    await this.loadIndex()

    // 语义模式：初始化向量存储
    if (this.config.mode === 'semantic') {
      await this.initSemanticComponents()
    }

    this.initialized = true
    logger.index.info(`[IndexService] Initialized (${this.config.mode} mode) for: `, this.workspacePath)
  }

  /** 加载结构化索引缓存 */
  private async loadStructuralIndex(): Promise<void> {
    try {
      const discardedLegacyCache = fs.existsSync(this.legacyStructuralIndexPath)
      if (discardedLegacyCache) {
        await fs.promises.rm(this.legacyStructuralIndexPath, { force: true })
      }
      this.bm25Index.clear()
      this.symbolIndex.clear()
      this.structuralBuildLanguages = {}
      this.structuralBuildFileSymbols = new Map()
      const metadata = await this.structuralStore.load(chunks => this.addStructuralChunks(chunks))
      this.structuralBuildLanguages = null
      this.structuralBuildFileSymbols = null

      if (!metadata) {
        this.status.totalChunks = 0
        this.status.indexedFiles = 0
        this.status.totalFiles = 0
        if (discardedLegacyCache) {
          this.projectSummary = null
          await this.summaryGenerator.clearCache()
        }
        return
      }

      this.status.totalChunks = metadata.totalChunks
      this.status.indexedFiles = this.bm25Index.fileCount
      this.status.totalFiles = metadata.totalFiles
      this.status.lastIndexedAt = metadata.savedAt
      logger.index.info(`[IndexService] Loaded structural index: ${this.bm25Index.size} chunks, ${this.symbolIndex.size} symbols`)
    } catch (e) {
      this.bm25Index.clear()
      this.symbolIndex.clear()
      this.status.totalChunks = 0
      this.status.indexedFiles = 0
      this.status.totalFiles = 0
      logger.index.warn('[IndexService] Failed to load structural index:', e)
    } finally {
      this.structuralBuildLanguages = null
      this.structuralBuildFileSymbols = null
    }
  }

  private async saveIndex(): Promise<void> {
    try {
      // 保存通用状态
      const dir = path.dirname(this.indexStatusPath)
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true })
      }
      await fs.promises.writeFile(this.indexStatusPath, JSON.stringify(this.status, null, 2))
    } catch (e) {
      logger.index.warn('[IndexService] Failed to save index status:', e)
    }
  }

  private async loadIndex(): Promise<void> {
    try {
      if (fs.existsSync(this.indexStatusPath)) {
        const content = await fs.promises.readFile(this.indexStatusPath, 'utf-8')
        const status = JSON.parse(content)
        // 恢复状态，除了 isIndexing
        this.status = { ...this.status, ...status, isIndexing: false, error: undefined, message: undefined }
        logger.index.info('[IndexService] Loaded index status')
      }

      if (this.config.mode === 'structural') {
        await this.loadStructuralIndex()
      } else if (this.config.mode === 'semantic') {
        // 语义模式下，chunks 数量可能需要从 vectorStore 获取？
        // 暂时相信保存的状态。
        // 也可以调用 vectorStore.count() 验证
        // if (this.vectorStore) { 
        //   this.status.totalChunks = await this.vectorStore.count()
        // }
      }
    } catch (e) {
      logger.index.warn('[IndexService] Failed to load index status:', e)
    }
  }

  /** 清除结构化索引缓存 */
  private async clearStructuralIndexCache(): Promise<void> {
    try {
      await this.structuralStore.request({ type: 'clear', databasePath: this.structuralIndexPath })
      await fs.promises.rm(this.legacyStructuralIndexPath, { force: true })
    } catch (e) {
      logger.index.warn('[IndexService] Failed to clear structural index cache:', e)
    }
  }

  getStatus(): IndexStatus {
    return { ...this.status }
  }

  getMode(): IndexMode {
    return this.config.mode
  }

  private enqueueMutation(operation: () => Promise<void>): Promise<void> {
    const result = this.mutationQueue.then(() => {
      if (this.destroyed) return
      return operation()
    })
    this.mutationQueue = result.catch(() => {})
    return result
  }

  /** 切换索引模式 */
  async setMode(mode: IndexMode): Promise<void> {
    return this.enqueueMutation(() => this.applyMode(mode))
  }

  private async applyMode(mode: IndexMode): Promise<void> {
    if (mode === this.config.mode) return

    this.config.mode = mode
    this.status.mode = mode

    if (mode === 'semantic') {
      await this.initSemanticComponents()
    }

    logger.index.info(`[IndexService] Switched to ${mode} mode`)
  }

  /** 检查是否有索引 */
  async hasIndex(): Promise<boolean> {
    // 检查内存中的索引
    if (this.bm25Index.size > 0) return true
    // 检查缓存的摘要
    if (this.projectSummary) return true
    // 语义模式检查向量存储
    if (this.config.mode === 'semantic') {
      return this.vectorStore?.hasIndex() ?? false
    }
    return false
  }

  /** 全量索引 */
  async indexWorkspace(): Promise<void> {
    if (this.destroyed) return
    if (this.pendingFullIndex) return this.pendingFullIndex

    const operation = this.enqueueMutation(() => this.performWorkspaceIndex())
    const tracked = operation.finally(() => {
      if (this.pendingFullIndex === tracked) this.pendingFullIndex = null
    })
    this.pendingFullIndex = tracked
    return tracked
  }

  private async performWorkspaceIndex(): Promise<void> {
    this.status = { ...this.status, isIndexing: true, totalFiles: 0, indexedFiles: 0, totalChunks: 0 }
    this.emitProgress()

    try {
      if (this.config.mode === 'structural') {
        await this.buildStructuralIndex()
      } else {
        await this.buildSemanticIndex()
      }
      if (this.destroyed) return

      this.status.isIndexing = false
      this.status.lastIndexedAt = Date.now()
      this.status.message = undefined
      await this.saveIndex()
      this.emitProgress(true)
    } catch (e) {
      if (this.destroyed) return
      logger.index.error('[IndexService] Indexing failed:', e)
      this.status.error = e instanceof Error ? e.message : String(e)
      this.status.isIndexing = false
      this.emitProgress(true)
    }
  }

  /** 搜索 */
  async search(query: string, topK: number = 10): Promise<SearchResult[]> {
    if (this.config.mode === 'structural') {
      return this.bm25Index.search(query, topK)
    }

    if (!this.vectorStore?.isInitialized() || !this.embedder) {
      await this.initSemanticComponents()
      if (!this.vectorStore?.isInitialized() || !this.embedder) {
        throw new Error('Semantic index not initialized (Initialization failed)')
      }
    }

    const queryVector = await this.embedder.embed(query)
    return this.vectorStore.search(queryVector, topK)
  }

  /** 混合搜索 */
  async hybridSearch(query: string, topK: number = 10): Promise<SearchResult[]> {
    if (this.config.mode === 'structural') {
      // 结构化模式:BM25 + 符号搜索融合
      // 扩大召回(topK*3),给 rerank 留足候选池
      const bm25Results = this.bm25Index.search(query, topK * 3)
      const symbolResults = this.symbolIndex.search(query, topK)

      const fused = this.fuseResults(bm25Results, symbolResults, topK * 3)
      return rerankCandidates(query, fused, { topK })
    }

    // 语义模式:向量 + 关键词搜索融合
    if (!this.vectorStore?.isInitialized() || !this.embedder) {
      await this.initSemanticComponents()
      if (!this.vectorStore?.isInitialized() || !this.embedder) {
        throw new Error('Semantic index not initialized (Initialization failed)')
      }
    }

    const keywords = this.extractKeywords(query)
    logger.index.info(`[IndexService] Hybrid search for "${query}", keywords: ${keywords.join(', ')}`)

    // 扩大召回,给 rerank 留足候选池
    const [semanticResults, keywordResults] = await Promise.all([
      this.search(query, topK * 3),
      keywords.length > 0 ? this.vectorStore.keywordSearch(keywords, topK * 3) : Promise.resolve([])
    ])

    logger.index.info(`[IndexService] Hybrid results - Semantic: ${semanticResults.length}, Keyword: ${keywordResults.length}`)

    let fused: SearchResult[]
    if (keywordResults.length === 0) {
      fused = semanticResults.slice(0, topK * 3)
    } else {
      fused = this.fuseResultsRRF(semanticResults, keywordResults, topK * 3)
    }
    return rerankCandidates(query, fused, { topK })
  }

  /** 符号搜索 */
  searchSymbols(query: string, topK: number = 20): SymbolInfo[] {
    return this.symbolIndex.search(query, topK)
  }

  /** 获取项目摘要 */
  getProjectSummary(): ProjectSummary | null {
    return this.projectSummary
  }

  /** 获取项目摘要文本 */
  getProjectSummaryText(): string {
    if (!this.projectSummary) return ''
    return this.summaryGenerator.toText(this.projectSummary)
  }

  /** 获取文件符号 */
  getFileSymbols(relativePath: string): SymbolInfo[] {
    return this.symbolIndex.getFileSymbols(relativePath)
  }

  /** 清空索引 */
  async clearIndex(): Promise<void> {
    return this.enqueueMutation(() => this.performClearIndex())
  }

  private async performClearIndex(): Promise<void> {
    this.bm25Index.clear()
    this.symbolIndex.clear()
    this.projectSummary = null

    if (this.vectorStore) {
      await this.vectorStore.clear()
    }

    // 删除缓存文件
    await this.summaryGenerator.clearCache()
    await this.clearStructuralIndexCache()

    this.status = { ...this.status, totalFiles: 0, indexedFiles: 0, totalChunks: 0 }
    logger.index.info('[IndexService] Index cleared')
  }

  /** 批量更新文件（用于文件监听） */
  async updateFiles(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0 || this.destroyed) return
    // The shared native watcher exists independently of code search. Do not
    // create a partial SQLite index merely because an ordinary file changed.
    if (!this.initialized && !this.pendingFullIndex) return
    if (!this.pendingFullIndex && this.status.lastIndexedAt === undefined) return
    return this.enqueueMutation(async () => {
      // A queued full build may have failed. Never turn its trailing watcher
      // events into an incomplete index.
      if (this.status.lastIndexedAt === undefined) return
      await this.performUpdateFiles(filePaths)
    })
  }

  private async performUpdateFiles(filePaths: string[]): Promise<void> {
    logger.index.info(`[IndexService] Updating ${filePaths.length} files...`)

    // 两种模式都通过 worker 处理。Promise 只在内存索引和持久化提交完成后解析，
    // 这样文件监听缓冲器才能提供真正的背压，而不是无限 postMessage。
    if (this.config.mode === 'semantic') await this.initSemanticComponents()
    if (!this.worker) this.initWorker()
    if (!this.worker) throw new Error('Index worker is unavailable')

    const requestId = this.nextWorkerRequestId++
    await new Promise<void>((resolve, reject) => {
      this.pendingWorkerUpdates.set(requestId, { resolve, reject })
      this.worker!.postMessage({
        type: 'batch_update',
        requestId,
        workspacePath: this.workspacePath,
        files: filePaths,
        config: this.config
      })
    })
  }

  /** 从结构化索引中删除文件 */
  private async deleteFileFromStructuralIndex(filePath: string): Promise<void> {
    const relativePath = normalizePath(path.relative(this.workspacePath, filePath))

    // 从 BM25 索引中删除
    this.bm25Index.deleteFile(relativePath)

    // 从符号索引中删除
    this.symbolIndex.deleteFile(relativePath)
  }

  /** 删除文件索引 */
  async deleteFileIndex(filePath: string): Promise<void> {
    if (this.destroyed) return
    if (!this.initialized && !this.pendingFullIndex) return
    if (!this.pendingFullIndex && this.status.lastIndexedAt === undefined) return
    return this.enqueueMutation(async () => {
      if (this.status.lastIndexedAt === undefined) return
      await this.performDeleteFileIndex(filePath)
    })
  }

  private async performDeleteFileIndex(filePath: string): Promise<void> {
    const relativePath = normalizePath(path.relative(this.workspacePath, filePath))

    // 结构化模式：从索引中删除
    if (this.config.mode === 'structural') {
      await this.deleteFileFromStructuralIndex(filePath)
      this.status.totalChunks = this.bm25Index.size
      this.status.indexedFiles = this.bm25Index.fileCount
      await this.structuralStore.request({
        type: 'applyFiles',
        databasePath: this.structuralIndexPath,
        files: [{ relativePath, chunks: [] }],
        metadata: {
          totalFiles: this.status.totalFiles,
          totalChunks: this.status.totalChunks,
          savedAt: Date.now(),
        },
      })
      logger.index.info(`[IndexService] Deleted structural index for: ${relativePath} `)
      return
    }

    // 语义模式：从向量存储删除
    if (this.config.mode === 'semantic' && this.vectorStore) {
      await this.vectorStore.deleteFile(filePath)
      logger.index.info(`[IndexService] Deleted semantic index for: ${relativePath} `)
    }
  }

  /** 更新 Embedding 配置 */
  updateEmbeddingConfig(config: Partial<EmbeddingConfig>): void {
    this.config.embedding = { ...this.config.embedding, ...config }
    if (this.embedder) {
      this.embedder.updateConfig(this.config.embedding)
    }
  }

  /** 测试 Embedding 连接 */
  async testEmbeddingConnection(): Promise<{ success: boolean; error?: string; latency?: number }> {
    if (!this.embedder) {
      this.embedder = new EmbeddingService(this.config.embedding)
    }
    return this.embedder.testConnection()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.status.isIndexing = false
    void this.structuralStore.close().catch(error => {
      logger.index.warn('[IndexService] Failed to close structural index store:', error)
    })
    const worker = this.worker
    this.worker = null
    void worker?.terminate()
    const error = new Error('Index service destroyed')
    this.pendingIndexReject?.(error)
    this.pendingIndexResolve = null
    this.pendingIndexReject = null
    for (const pending of this.pendingWorkerUpdates.values()) pending.reject(error)
    this.pendingWorkerUpdates.clear()
  }

  // ==================== 结构化索引 ====================

  private async buildStructuralIndex(): Promise<void> {
    this.bm25Index.clear()
    this.symbolIndex.clear()
    this.structuralBuildLanguages = {}
    this.structuralBuildFileSymbols = new Map()
    const generation = randomUUID()
    this.structuralBuildGeneration = generation

    try {
      await this.structuralStore.request({
        type: 'beginReplace',
        databasePath: this.structuralIndexPath,
        generation,
      })
      await this.startWorkerIndex()
      if (this.destroyed) return

      this.status.indexedFiles = this.bm25Index.fileCount
      this.projectSummary = this.summaryGenerator.generate(
        this.structuralBuildFileSymbols,
        this.structuralBuildLanguages,
      )
      await this.structuralStore.request({
        type: 'commitReplace',
        databasePath: this.structuralIndexPath,
        generation,
        metadata: {
          totalFiles: this.status.totalFiles,
          totalChunks: this.bm25Index.size,
          savedAt: Date.now(),
        },
      })
    } catch (error) {
      await this.structuralStore.request({
        type: 'abortReplace',
        databasePath: this.structuralIndexPath,
        generation,
      }).catch(() => {})
      this.bm25Index.clear()
      this.symbolIndex.clear()
      throw error
    } finally {
      this.structuralBuildGeneration = null
      this.structuralBuildFileSymbols = null
      this.structuralBuildLanguages = null
    }

    logger.index.info(`[IndexService] Structural index built: ${this.bm25Index.size} chunks, ${this.symbolIndex.size} symbols`)
  }

  // ==================== 语义索引 ====================

  private async initSemanticComponents(): Promise<void> {
    if (!this.embedder) {
      this.embedder = new EmbeddingService(this.config.embedding)
    }

    if (!this.vectorStore) {
      this.vectorStore = new VectorStoreService(this.workspaceCachePath)
    }

    if (!this.vectorStore.isInitialized()) {
      await this.vectorStore.initialize()
    }
  }

  private async buildSemanticIndex(): Promise<void> {
    await this.initSemanticComponents()

    const existingHashesMap = await this.vectorStore!.getFileHashes()
    const existingHashes: Record<string, string> = Object.fromEntries(existingHashesMap)

    return this.startWorkerIndex(existingHashes)
  }

  private startWorkerIndex(existingHashes?: Record<string, string>): Promise<void> {
    if (!this.worker) this.initWorker()
    if (!this.worker) return Promise.reject(new Error('Index worker is unavailable'))

    return new Promise<void>((resolve, reject) => {
      this.pendingIndexResolve = resolve
      this.pendingIndexReject = reject
      this.worker!.postMessage({
        type: 'index',
        workspacePath: this.workspacePath,
        config: this.config,
        existingHashes,
      })
    })
  }

  private initWorker(): void {
    try {
      const workerPath = path.join(__dirname, 'indexer.worker.js')
      const worker = new Worker(workerPath)
      this.worker = worker

      worker.on('message', (message: WorkerMessage) => {
        // worker_threads does not await async event handlers. Chain messages so
        // vector-store writes are committed in the same order the worker emits
        // them, and `complete` cannot overtake an earlier result batch.
        this.workerMessageQueue = this.workerMessageQueue.then(async () => {
          if (this.destroyed) return
          switch (message.type) {
            case 'progress':
              this.status.indexedFiles = message.processed
              if (message.total) this.status.totalFiles = message.total
              if (message.message) {
                this.status.message = message.message
                this.emitProgress(true)
              }
              this.emitProgress()
              break

            case 'structural_result':
              this.addStructuralChunks(message.chunks)
              if (this.structuralBuildGeneration) {
                await this.structuralStore.request({
                  type: 'appendReplace',
                  databasePath: this.structuralIndexPath,
                  generation: this.structuralBuildGeneration,
                  chunks: message.chunks,
                })
              }
              worker.postMessage({ type: 'structural_ack', requestId: message.requestId })
              this.status.indexedFiles = message.processed
              this.status.totalFiles = message.total
              this.status.totalChunks += message.chunks.length
              this.emitProgress()
              break

            case 'result':
              if (message.chunks?.length > 0) {
                await this.vectorStore!.addBatch(message.chunks)
                this.status.totalChunks += message.chunks.length
              }
              this.status.indexedFiles = message.processed
              this.emitProgress()
              break

            case 'update_result':
              if (message.deleted) {
                await this.vectorStore!.deleteFile(message.filePath)
              } else if (message.chunks?.length > 0) {
                await this.vectorStore!.upsertFile(message.filePath, message.chunks)
              }
              this.emitProgress()
              break

            case 'batch_update_result':
              if (message.mode === 'structural') {
                const persistedFiles: Array<{ relativePath: string; chunks: CodeChunk[] }> = []
                for (const result of message.results) {
                  const relativePath = normalizePath(path.relative(this.workspacePath, result.filePath))
                  await this.deleteFileFromStructuralIndex(result.filePath)
                  if (!result.deleted) this.addStructuralChunks(result.chunks)
                  persistedFiles.push({
                    relativePath,
                    chunks: result.deleted ? [] : result.chunks,
                  })
                }
                this.status.totalChunks = this.bm25Index.size
                this.status.indexedFiles = this.bm25Index.fileCount
                if (persistedFiles.length > 0) {
                  await this.structuralStore.request({
                    type: 'applyFiles',
                    databasePath: this.structuralIndexPath,
                    files: persistedFiles,
                    metadata: {
                      totalFiles: this.status.totalFiles,
                      totalChunks: this.status.totalChunks,
                      savedAt: Date.now(),
                    },
                  })
                }
                logger.index.info(`[IndexService] Updated ${persistedFiles.length} files in structural index`)
              } else {
                for (const result of message.results) {
                  if (result.deleted) {
                    await this.vectorStore!.deleteFile(result.filePath)
                  } else if (result.chunks.length > 0) {
                    await this.vectorStore!.upsertFile(result.filePath, result.chunks)
                  }
                }
              }
              this.emitProgress()
              this.pendingWorkerUpdates.get(message.requestId)?.resolve()
              this.pendingWorkerUpdates.delete(message.requestId)
              break

            case 'complete':
              if (typeof message.totalChunks === 'number') {
                this.status.totalChunks = message.totalChunks
              }
              if (this.pendingIndexResolve) {
                this.pendingIndexResolve()
                this.pendingIndexResolve = null
                this.pendingIndexReject = null
              }
              break

            case 'error': {
              logger.index.error('[IndexService] Worker error:', message.error)
              const error = new Error(message.error)
              if (message.requestId !== undefined) {
                this.pendingWorkerUpdates.get(message.requestId)?.reject(error)
                this.pendingWorkerUpdates.delete(message.requestId)
                break
              }
              this.status.error = message.error
              this.status.isIndexing = false
              this.status.message = undefined
              this.emitProgress(true)
              if (this.pendingIndexReject) {
                this.pendingIndexReject(error)
                this.pendingIndexResolve = null
                this.pendingIndexReject = null
              }
              break
            }
          }
        }).catch(error => {
          this.handleWorkerFailure(error instanceof Error ? error : new Error(String(error)))
        })
      })

      worker.on('error', (err) => {
        this.handleWorkerFailure(err)
      })

      worker.on('exit', (code) => {
        if (this.destroyed || this.worker !== worker) return
        this.worker = null
        this.handleWorkerFailure(new Error(`Index worker exited unexpectedly with code ${code}`))
      })
    } catch (e) {
      logger.index.error('[IndexService] Failed to initialize worker:', e)
    }
  }

  private handleWorkerFailure(error: Error): void {
    if (this.destroyed) return

    const worker = this.worker
    this.worker = null
    void worker?.terminate()

    logger.index.error('[IndexService] Worker thread error:', error.message)
    this.status.error = error.message
    this.status.isIndexing = false
    this.status.message = undefined
    this.emitProgress(true)

    this.pendingIndexReject?.(error)
    this.pendingIndexResolve = null
    this.pendingIndexReject = null

    for (const pending of this.pendingWorkerUpdates.values()) pending.reject(error)
    this.pendingWorkerUpdates.clear()
  }

  private addStructuralChunks(chunks: CodeChunk[]): void {
    for (const chunk of chunks) {
      this.bm25Index.addDocument({
        id: chunk.id,
        filePath: chunk.filePath,
        relativePath: chunk.relativePath,
        content: chunk.content,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        type: chunk.type,
        language: chunk.language,
        symbols: chunk.symbols || [],
      })

      if (this.structuralBuildLanguages) {
        this.structuralBuildLanguages[chunk.language] =
          (this.structuralBuildLanguages[chunk.language] || 0) + 1
      }

      if (!chunk.symbols?.length) continue
      const fileSymbols = this.structuralBuildFileSymbols?.get(chunk.relativePath) || []
      for (const name of chunk.symbols) {
        const symbol: SymbolInfo = {
          name,
          kind: chunk.type === 'class' ? 'class' : 'function',
          filePath: chunk.filePath,
          relativePath: chunk.relativePath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          signature: chunk.content.split('\n')[0].slice(0, 100),
        }
        fileSymbols.push(symbol)
        this.symbolIndex.add(symbol)
      }
      this.structuralBuildFileSymbols?.set(chunk.relativePath, fileSymbols)
    }
  }

  // ==================== 工具方法 ====================
  private extractKeywords(query: string): string[] {
    return query.split(/[\s,.:;!?()[\]{}'"<>]+/).map(t => t.trim()).filter(t => t.length >= 2 && !/^\d+$/.test(t))
  }

  /** 融合 BM25 和符号搜索结果 */
  private fuseResults(bm25Results: SearchResult[], symbolResults: SymbolInfo[], topK: number): SearchResult[] {
    const scoreMap = new Map<string, { result: SearchResult; score: number }>()

    // BM25 结果
    bm25Results.forEach((result, rank) => {
      const key = `${result.filePath}:${result.startLine} `
      scoreMap.set(key, { result, score: result.score + (bm25Results.length - rank) / bm25Results.length })
    })

    // 符号匹配加分
    for (const symbol of symbolResults) {
      const key = `${symbol.filePath}:${symbol.startLine} `
      const existing = scoreMap.get(key)
      if (existing) {
        existing.score += 0.5
      }
    }

    return Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ result, score }) => ({ ...result, score }))
  }

  /** RRF 融合 */
  private fuseResultsRRF(results1: SearchResult[], results2: SearchResult[], topK: number): SearchResult[] {
    const k = 60
    const scoreMap = new Map<string, { result: SearchResult; score: number }>()

    results1.forEach((result, rank) => {
      const key = `${result.filePath}:${result.startLine} `
      scoreMap.set(key, { result, score: 0.7 / (k + rank + 1) })
    })

    results2.forEach((result, rank) => {
      const key = `${result.filePath}:${result.startLine} `
      const existing = scoreMap.get(key)
      if (existing) {
        existing.score += 0.3 / (k + rank + 1)
      } else {
        scoreMap.set(key, { result, score: 0.3 / (k + rank + 1) })
      }
    })

    return Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ result, score }) => ({ ...result, score }))
  }

  private emitProgress(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastProgressEmit < this.PROGRESS_THROTTLE_MS) return
    this.lastProgressEmit = now

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send('index:progress', this.status)
      } catch { }
    }
  }
}

// ==================== 实例管理 ====================

const instances = new Map<string, CodebaseIndexService>()

export function getIndexService(workspacePath: string): CodebaseIndexService {
  const normalized = normalizePath(workspacePath)
  let instance = instances.get(normalized)
  if (!instance) {
    instance = new CodebaseIndexService(workspacePath)
    instances.set(normalized, instance)
  }
  return instance
}

export function initIndexServiceWithConfig(workspacePath: string, config: Partial<IndexConfig>): CodebaseIndexService {
  const normalized = normalizePath(workspacePath)
  let instance = instances.get(normalized)
  if (!instance) {
    instance = new CodebaseIndexService(workspacePath, config)
    instances.set(normalized, instance)
  } else {
    // 更新现有实例的配置
    if (config.mode) instance.setMode(config.mode)
    if (config.embedding) instance.updateEmbeddingConfig(config.embedding)
  }
  return instance
}

export function destroyIndexService(workspacePath?: string): void {
  if (workspacePath) {
    const normalized = normalizePath(workspacePath)
    const instance = instances.get(normalized)
    if (instance) {
      instance.destroy()
      instances.delete(normalized)
    }
  } else {
    for (const instance of instances.values()) {
      instance.destroy()
    }
    instances.clear()
  }
}
