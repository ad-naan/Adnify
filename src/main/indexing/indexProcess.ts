import { BrowserWindow } from 'electron'
import * as path from 'node:path'
import { UtilityProcessClient } from '../services/process/UtilityProcessClient'
import { getUserConfigDir, getWorkspaceCacheDir } from '../services/configPath'
import type { IndexProcessOperation } from './indexProcessProtocol'
import type { EmbeddingConfig, IndexConfig, IndexMode, IndexStatus, ProjectSummary, SearchResult, SymbolInfo } from './types'

/** Main-process facade. Index data, parsers, native databases and models live in the child. */
export class CodebaseIndexProcess {
  private client: UtilityProcessClient
  private initialized?: Promise<void>
  private enabled = false
  private windows = new Map<number, BrowserWindow>()
  private windowCleanup = new Map<number, () => void>()
  private status: IndexStatus = { mode: 'structural', isIndexing: false, totalFiles: 0, indexedFiles: 0, totalChunks: 0 }
  private configuration: Partial<IndexConfig>
  private configureQueue: Promise<void> = Promise.resolve()
  private processEpoch = 0

  constructor(
    private readonly workspacePath: string,
    config: Partial<IndexConfig> = {},
    private readonly beforeStart: Promise<void> = Promise.resolve(),
  ) {
    this.configuration = { ...config }
    this.status.mode = config.mode ?? 'structural'
    this.client = new UtilityProcessClient({
      entry: path.join(__dirname, 'indexService.utility.js'), name: 'Adnify Code Index', network: true,
      timeoutMs: 120_000,
      onNotification: value => { this.status = value as IndexStatus; this.emitProgress() },
      onExit: () => {
        this.processEpoch++
        this.initialized = undefined
        this.configureQueue = Promise.resolve()
        this.status = { ...this.status, isIndexing: false, error: 'Index process stopped. Rebuild the index to reconcile interrupted changes.' }
        this.emitProgress()
      },
    })
  }

  get pid(): number | undefined { return this.client.pid }
  setMainWindow(window: BrowserWindow): void {
    if (this.windows.has(window.id)) return
    const id = window.id
    this.windows.set(id, window)
    const closed = () => { this.windows.delete(id); this.windowCleanup.delete(id) }
    window.once('closed', closed)
    this.windowCleanup.set(id, () => window.removeListener('closed', closed))
  }
  private emitProgress(): void {
    for (const window of this.windows.values()) {
      try {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('index:progress', this.status)
      } catch { /* A window may close between the check and delivery. */ }
    }
  }
  async initialize(): Promise<void> {
    this.enabled = true
    if (!this.initialized) {
      const pending = this.beforeStart.then(() => this.client.request<IndexStatus>({
        type: 'initialize', workspacePath: this.workspacePath, config: this.configuration,
        paths: { workspaceCachePath: getWorkspaceCacheDir(this.workspacePath), modelCachePath: path.join(getUserConfigDir(), 'models') },
      } satisfies IndexProcessOperation)).then(status => { this.status = status }).catch(error => {
        if (this.initialized === pending) this.initialized = undefined
        throw error
      })
      this.initialized = pending
    }
    await this.initialized
    await this.configureQueue
  }
  private async call<T>(operation: IndexProcessOperation, timeoutMs?: number): Promise<T> {
    await this.initialize()
    return this.client.request<T>(operation, { timeoutMs })
  }
  getStatus(): IndexStatus { return { ...this.status } }
  getMode(): IndexMode { return this.configuration.mode ?? 'structural' }
  hasIndex(): Promise<boolean> { return this.call({ type: 'hasIndex' }) }
  indexWorkspace(): Promise<void> { return this.call({ type: 'indexWorkspace' }, 60 * 60_000) }
  search(query: string, topK = 10): Promise<SearchResult[]> { return this.call({ type: 'search', query, topK }) }
  hybridSearch(query: string, topK = 10): Promise<SearchResult[]> { return this.call({ type: 'hybridSearch', query, topK }) }
  searchSymbols(query: string, topK = 20): Promise<SymbolInfo[]> { return this.call({ type: 'searchSymbols', query, topK }) }
  getProjectSummary(): Promise<ProjectSummary | null> { return this.call({ type: 'getProjectSummary' }) }
  getProjectSummaryText(): Promise<string> { return this.call({ type: 'getProjectSummaryText' }) }
  getFileSymbols(relativePath: string): Promise<SymbolInfo[]> { return this.call({ type: 'getFileSymbols', relativePath }) }
  clearIndex(): Promise<void> { return this.call({ type: 'clearIndex' }) }
  testEmbeddingConnection(): Promise<{ success: boolean; error?: string; latency?: number }> { return this.call({ type: 'testEmbeddingConnection' }) }
  updateFiles(paths: string[]): Promise<void> { return this.enabled ? this.call({ type: 'updateFiles', paths }, 60 * 60_000) : Promise.resolve() }
  deleteFileIndex(filePath: string): Promise<void> { return this.enabled ? this.call({ type: 'deleteFileIndex', path: filePath }) : Promise.resolve() }
  async setMode(mode: IndexMode): Promise<void> {
    if (mode === this.configuration.mode) return this.configureQueue
    this.configuration.mode = mode
    this.status.mode = mode
    if (this.initialized) {
      const initialized = this.initialized, epoch = this.processEpoch
      this.configureQueue = this.configureQueue.catch(() => {}).then(async () => {
        await initialized
        if (epoch !== this.processEpoch) throw new Error('Index process changed while applying configuration')
        await this.client.request({ type: 'setMode', mode } satisfies IndexProcessOperation)
      })
    }
    return this.configureQueue
  }
  async updateEmbeddingConfig(config: Partial<EmbeddingConfig>): Promise<void> {
    const next = { ...this.configuration.embedding, ...config } as EmbeddingConfig
    if (JSON.stringify(next) === JSON.stringify(this.configuration.embedding)) return this.configureQueue
    this.configuration.embedding = next
    if (this.initialized) {
      const initialized = this.initialized, epoch = this.processEpoch
      this.configureQueue = this.configureQueue.catch(() => {}).then(async () => {
        await initialized
        if (epoch !== this.processEpoch) throw new Error('Index process changed while applying configuration')
        await this.client.request({ type: 'updateEmbeddingConfig', config: next } satisfies IndexProcessOperation)
      })
    }
    return this.configureQueue
  }
  async destroy(): Promise<void> {
    this.enabled = false
    for (const cleanup of this.windowCleanup.values()) cleanup()
    this.windowCleanup.clear()
    this.windows.clear()
    await this.client.close({ type: 'destroy' })
  }
}

const instances = new Map<string, CodebaseIndexProcess>()
const closing = new Map<string, Promise<void>>()
const key = (root: string) => {
  const resolved = path.resolve(root).replace(/\\/g, '/')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}
export function getIndexService(workspacePath: string): CodebaseIndexProcess {
  return initIndexServiceWithConfig(workspacePath, {})
}
export function initIndexServiceWithConfig(workspacePath: string, config: Partial<IndexConfig>): CodebaseIndexProcess {
  const id = key(workspacePath)
  let instance = instances.get(id)
  if (!instance) {
    instance = new CodebaseIndexProcess(workspacePath, config, closing.get(id))
    instances.set(id, instance)
  } else {
    // initialize() observes the same queue, so its caller receives configuration failures.
    if (config.mode) void instance.setMode(config.mode).catch(() => {})
    if (config.embedding) void instance.updateEmbeddingConfig(config.embedding).catch(() => {})
  }
  return instance
}
export async function destroyIndexService(workspacePath?: string): Promise<void> {
  const id = workspacePath ? key(workspacePath) : undefined
  const targets = [...instances.entries()].filter(([root]) => id === undefined || root === id)
  for (const [root, instance] of targets) {
    instances.delete(root)
    // A quick workspace close/reopen must finish draining its previous writer.
    const pending = Promise.all([closing.get(root), instance.destroy()]).then(() => {})
    closing.set(root, pending)
    void pending.then(() => { if (closing.get(root) === pending) closing.delete(root) }, () => {})
  }
  await Promise.allSettled(id === undefined ? [...closing.values()] : [closing.get(id)])
}
