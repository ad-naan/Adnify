/**
 * .adnify 目录统一管理服务
 *
 * 所有项目级数据都存储在 .adnify 目录下：
 * .adnify/
 *   ├── index/               # 代码库向量索引
 *   ├── sessions/            # Agent 会话（按线程拆分）
 *   │   ├── _meta.json       # 线程索引元数据（currentThreadId, threadIds, version）
 *   │   ├── _extra.json      # 非线程快照状态（branches, checkpoints 等）
 *   │   └── {threadId}.json  # 单个线程数据
 *   ├── saved-sessions/      # 已保存会话（index + jsonl）
 *   ├── settings.json        # 项目级设置
 *   ├── workspace-state.json # 工作区状态（打开的文件等）
 *   └── rules.md             # 项目 AI 规则
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { getEditorConfig } from '@renderer/settings'

export const ADNIFY_DIR_NAME = '.adnify'

export const ADNIFY_FILES = {
  INDEX_DIR: 'index',
  SESSIONS_DIR: 'sessions',
  SAVED_SESSIONS_DIR: 'saved-sessions',
  SETTINGS: 'settings.json',
  WORKSPACE_STATE: 'workspace-state.json',
  RULES: 'rules.md',
} as const

type AdnifyFile = typeof ADNIFY_FILES[keyof typeof ADNIFY_FILES]

interface SessionIndexMeta {
  currentThreadId: string | null
  threadIds: string[]
  version: number
}

export interface SessionMeta extends SessionIndexMeta {
  extra: Record<string, unknown>
}

export interface WorkspaceStateData {
  openFiles: string[]
  activeFile: string | null
  expandedFolders: string[]
  scrollPositions: Record<string, number>
  cursorPositions: Record<string, { line: number; column: number }>
  layout?: {
    sidebarWidth: number
    chatWidth: number
    terminalVisible: boolean
    terminalLayout: 'tabs' | 'split'
  }
}

export interface ProjectSettingsData {
  checkpointRetention: {
    maxCount: number
    maxAgeDays: number
    maxFileSizeKB: number
  }
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error'
    saveToFile: boolean
  }
  agent: {
    autoApproveReadOnly: boolean
    maxToolCallsPerTurn: number
  }
}

const DEFAULT_WORKSPACE_STATE: WorkspaceStateData = {
  openFiles: [],
  activeFile: null,
  expandedFolders: [],
  scrollPositions: {},
  cursorPositions: {},
}

const DEFAULT_PROJECT_SETTINGS: ProjectSettingsData = {
  checkpointRetention: {
    maxCount: 50,
    maxAgeDays: 7,
    maxFileSizeKB: 100,
  },
  logging: {
    level: 'info',
    saveToFile: false,
  },
  agent: {
    autoApproveReadOnly: true,
    maxToolCallsPerTurn: 25,
  },
}

const DEFAULT_SESSION_META: SessionMeta = {
  currentThreadId: null,
  threadIds: [],
  extra: {},
  version: 0,
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(',')}}`
}

function toSessionIndexMeta(meta: SessionMeta): SessionIndexMeta {
  return {
    currentThreadId: meta.currentThreadId,
    threadIds: meta.threadIds,
    version: meta.version,
  }
}

class AdnifyDirService {
  private primaryRoot: string | null = null
  private initializedRoots: Set<string> = new Set()
  private initialized = false

  private cache: {
    sessionMeta: SessionMeta | null
    threads: Map<string, unknown>
    workspaceState: WorkspaceStateData | null
    settings: ProjectSettingsData | null
  } = {
    sessionMeta: null,
    threads: new Map(),
    workspaceState: null,
    settings: null,
  }

  private dirty: {
    sessionMeta: boolean
    dirtyThreads: Set<string>
    workspaceState: boolean
    settings: boolean
  } = {
    sessionMeta: false,
    dirtyThreads: new Set(),
    workspaceState: false,
    settings: false,
  }

  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private threadHashes: Map<string, string> = new Map()
  private metaHash: string | null = null
  private metaWriteRevision = 0

  async initialize(rootPath: string): Promise<boolean> {
    if (this.initializedRoots.has(rootPath)) return true

    try {
      const adnifyPath = `${rootPath}/${ADNIFY_DIR_NAME}`
      if (!await api.file.exists(adnifyPath)) {
        await api.file.ensureDir(adnifyPath)
      }

      const requiredDirs = [
        `${adnifyPath}/${ADNIFY_FILES.INDEX_DIR}`,
        `${adnifyPath}/${ADNIFY_FILES.SESSIONS_DIR}`,
        `${adnifyPath}/${ADNIFY_FILES.SAVED_SESSIONS_DIR}`,
      ]

      await Promise.all(requiredDirs.map(async dirPath => {
        if (!await api.file.exists(dirPath)) {
          await api.file.ensureDir(dirPath)
        }
      }))

      this.initializedRoots.add(rootPath)
      logger.system.info('[AdnifyDir] Root initialized:', rootPath)
      return true
    } catch (error) {
      logger.system.error('[AdnifyDir] Root initialization failed:', rootPath, error)
      return false
    }
  }

  async ensureSavedSessionsDir(): Promise<void> {
    if (!this.primaryRoot) return
    const dirPath = this.getFilePath(ADNIFY_FILES.SAVED_SESSIONS_DIR)
    if (!await api.file.exists(dirPath)) {
      await api.file.ensureDir(dirPath)
    }
  }

  async setPrimaryRoot(rootPath: string): Promise<void> {
    if (this.primaryRoot === rootPath) return

    if (this.primaryRoot) {
      await this.flush()
    }

    this.primaryRoot = rootPath
    await this.initialize(rootPath)
    await this.migrateOldSessions()
    await this.loadAllData()
    this.initialized = true
    logger.system.info('[AdnifyDir] Primary root set:', rootPath)
  }

  reset(): void {
    this.primaryRoot = null
    this.initializedRoots.clear()
    this.initialized = false
    this.cache = { sessionMeta: null, threads: new Map(), workspaceState: null, settings: null }
    this.dirty = { sessionMeta: false, dirtyThreads: new Set(), workspaceState: false, settings: false }
    this.threadHashes.clear()
    this.metaHash = null
    this.metaWriteRevision = 0
    logger.system.info('[AdnifyDir] Reset')
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    if (!this.initialized || !this.primaryRoot) return

    const metaToWrite = this.dirty.sessionMeta && this.cache.sessionMeta
      ? {
          index: toSessionIndexMeta(this.cache.sessionMeta),
          extra: { ...this.cache.sessionMeta.extra },
        }
      : null
    const metaRevision = metaToWrite ? ++this.metaWriteRevision : 0

    const promises: Promise<void>[] = []

    if (metaToWrite) {
      promises.push(this.writeSessionFile('_meta.json', metaToWrite.index))
      promises.push(this.writeSessionFile('_extra.json', metaToWrite.extra))
    }

    const flushedThreadIds = [...this.dirty.dirtyThreads]
    for (const threadId of flushedThreadIds) {
      const data = this.cache.threads.get(threadId)
      if (data !== undefined) {
        promises.push(this.writeSessionFile(`${threadId}.json`, data))
        this.threadHashes.set(threadId, stableStringify(data))
      }
    }

    if (this.dirty.workspaceState && this.cache.workspaceState) {
      promises.push(this.writeJsonFile(ADNIFY_FILES.WORKSPACE_STATE, this.cache.workspaceState))
    }

    if (this.dirty.settings && this.cache.settings) {
      promises.push(this.writeJsonFile(ADNIFY_FILES.SETTINGS, this.cache.settings))
    }

    if (promises.length > 0) {
      await Promise.all(promises)
      if (metaToWrite && this.metaWriteRevision === metaRevision) {
        this.dirty.sessionMeta = false
        this.metaHash = stableStringify({ ...metaToWrite.index, extra: metaToWrite.extra })
      }
      for (const threadId of flushedThreadIds) {
        this.dirty.dirtyThreads.delete(threadId)
      }
      if (this.dirty.workspaceState && this.cache.workspaceState) {
        this.dirty.workspaceState = false
      }
      if (this.dirty.settings && this.cache.settings) {
        this.dirty.settings = false
      }
      logger.system.info('[AdnifyDir] Flushed all dirty data')
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush().catch(err => logger.system.error('[AdnifyDir] Flush error:', err))
    }, getEditorConfig().performance.flushIntervalMs)
  }

  isInitialized(): boolean {
    return this.initialized && this.primaryRoot !== null
  }

  getPrimaryRoot(): string | null {
    return this.primaryRoot
  }

  getDirPath(rootPath?: string): string {
    const targetRoot = rootPath || this.primaryRoot
    if (!targetRoot) {
      throw new Error('[AdnifyDir] Not initialized')
    }
    return `${targetRoot}/${ADNIFY_DIR_NAME}`
  }

  getFilePath(file: AdnifyFile | string, rootPath?: string): string {
    return `${this.getDirPath(rootPath)}/${file}`
  }

  async getSessionMeta(): Promise<SessionMeta> {
    if (this.cache.sessionMeta) return this.cache.sessionMeta
    if (!this.isInitialized()) return { ...DEFAULT_SESSION_META }

    const [indexMeta, extra] = await Promise.all([
      this.readSessionFile<SessionIndexMeta>('_meta.json'),
      this.readSessionFile<Record<string, unknown>>('_extra.json'),
    ])

    this.cache.sessionMeta = {
      currentThreadId: indexMeta?.currentThreadId ?? null,
      threadIds: indexMeta?.threadIds ?? [],
      version: indexMeta?.version ?? 0,
      extra: extra ?? {},
    }
    this.metaHash = stableStringify(this.cache.sessionMeta)
    return this.cache.sessionMeta
  }

  async getThreadData(threadId: string): Promise<unknown | null> {
    if (this.cache.threads.has(threadId)) return this.cache.threads.get(threadId)!
    if (!this.isInitialized()) return null
    const data = await this.readSessionFile<unknown>(`${threadId}.json`)
    if (data !== null) {
      this.cache.threads.set(threadId, data)
      this.threadHashes.set(threadId, stableStringify(data))
    }
    return data
  }

  setThreadDirty(threadId: string, data: unknown): void {
    const nextHash = stableStringify(data)
    const prevHash = this.threadHashes.get(threadId)
    this.cache.threads.set(threadId, data)
    if (prevHash === nextHash) return
    this.dirty.dirtyThreads.add(threadId)
    this.threadHashes.set(threadId, nextHash)
    this.scheduleFlush()
  }

  setSessionMetaDirty(meta: SessionMeta): void {
    const nextHash = stableStringify(meta)
    this.cache.sessionMeta = meta
    if (this.metaHash === nextHash) return
    this.metaHash = nextHash
    this.dirty.sessionMeta = true
    this.scheduleFlush()
  }

  async deleteThreadData(threadId: string): Promise<void> {
    this.cache.threads.delete(threadId)
    this.dirty.dirtyThreads.delete(threadId)
    this.threadHashes.delete(threadId)

    const meta = await this.getSessionMeta()
    const nextThreadIds = meta.threadIds.filter(id => id !== threadId)
    this.setSessionMetaDirty({
      ...meta,
      threadIds: nextThreadIds,
      currentThreadId: meta.currentThreadId === threadId ? (nextThreadIds[0] || null) : meta.currentThreadId,
    })

    if (this.isInitialized()) {
      try {
        const filePath = `${this.getDirPath()}/${ADNIFY_FILES.SESSIONS_DIR}/${threadId}.json`
        await api.file.delete(filePath)
      } catch {
        // ignore
      }
    }
  }

  async clearAllSessions(): Promise<void> {
    const meta = await this.getSessionMeta()
    await Promise.all(meta.threadIds.map(async threadId => {
      this.cache.threads.delete(threadId)
      this.threadHashes.delete(threadId)
      try {
        const filePath = `${this.getDirPath()}/${ADNIFY_FILES.SESSIONS_DIR}/${threadId}.json`
        await api.file.delete(filePath)
      } catch {
        // ignore
      }
    }))
    this.cache.sessionMeta = { ...DEFAULT_SESSION_META }
    this.metaHash = stableStringify(this.cache.sessionMeta)
    this.dirty.sessionMeta = false
    this.dirty.dirtyThreads.clear()
    await Promise.all([
      this.writeSessionFile('_meta.json', toSessionIndexMeta(this.cache.sessionMeta)),
      this.writeSessionFile('_extra.json', this.cache.sessionMeta.extra),
    ])
  }

  async getFullSessionData(): Promise<Record<string, unknown> | null> {
    const meta = await this.getSessionMeta()
    const hasPersistedMeta = meta.threadIds.length > 0 || !!meta.currentThreadId

    if (!hasPersistedMeta) {
      const rebuiltMeta = await this.rebuildMetaFromThreadFiles(meta.extra)
      if (!rebuiltMeta || (rebuiltMeta.threadIds.length === 0 && !rebuiltMeta.currentThreadId)) {
        return null
      }
      this.cache.sessionMeta = rebuiltMeta
      this.metaHash = stableStringify(rebuiltMeta)
    }

    const effectiveMeta = this.cache.sessionMeta || meta
    const threadEntries = await Promise.all(
      effectiveMeta.threadIds.map(async threadId => [threadId, await this.getThreadData(threadId)] as const)
    )

    const threads: Record<string, unknown> = {}
    for (const [threadId, data] of threadEntries) {
      if (data !== null) {
        threads[threadId] = data
      }
    }

    return {
      state: {
        threads,
        currentThreadId: effectiveMeta.currentThreadId,
        ...effectiveMeta.extra,
      },
      version: effectiveMeta.version,
    }
  }

  setFullSessionDataDirty(_storeKey: string, parsed: Record<string, unknown>): void {
    const state = parsed.state as Record<string, unknown> | undefined
    if (!state) return

    const threads = (state.threads || {}) as Record<string, unknown>
    const currentThreadId = state.currentThreadId as string | null
    const { threads: _threads, currentThreadId: _currentThreadId, ...extra } = state

    this.setSessionMetaDirty({
      currentThreadId,
      threadIds: Object.keys(threads),
      extra,
      version: (parsed.version as number) || 0,
    })

    for (const [threadId, data] of Object.entries(threads)) {
      this.setThreadDirty(threadId, data)
    }

    for (const cachedId of [...this.cache.threads.keys()]) {
      if (!Object.prototype.hasOwnProperty.call(threads, cachedId)) {
        this.cache.threads.delete(cachedId)
        this.dirty.dirtyThreads.delete(cachedId)
        this.threadHashes.delete(cachedId)
        if (this.isInitialized()) {
          const filePath = `${this.getDirPath()}/${ADNIFY_FILES.SESSIONS_DIR}/${cachedId}.json`
          api.file.delete(filePath).catch(() => { /* ignore */ })
        }
      }
    }
  }

  async getWorkspaceState(): Promise<WorkspaceStateData> {
    if (this.cache.workspaceState) return this.cache.workspaceState
    if (!this.isInitialized()) return { ...DEFAULT_WORKSPACE_STATE }
    const data = await this.readJsonFile<WorkspaceStateData>(ADNIFY_FILES.WORKSPACE_STATE)
    this.cache.workspaceState = data || { ...DEFAULT_WORKSPACE_STATE }
    return this.cache.workspaceState
  }

  async saveWorkspaceState(data: WorkspaceStateData): Promise<void> {
    this.cache.workspaceState = data
    this.dirty.workspaceState = true
  }

  async getSettings(): Promise<ProjectSettingsData> {
    if (this.cache.settings) return this.cache.settings
    if (!this.isInitialized()) return { ...DEFAULT_PROJECT_SETTINGS }
    const data = await this.readJsonFile<ProjectSettingsData>(ADNIFY_FILES.SETTINGS)
    this.cache.settings = data ? { ...DEFAULT_PROJECT_SETTINGS, ...data } : { ...DEFAULT_PROJECT_SETTINGS }
    return this.cache.settings
  }

  async saveSettings(data: ProjectSettingsData): Promise<void> {
    this.cache.settings = data
    this.dirty.settings = true
    if (this.isInitialized()) {
      await this.writeJsonFile(ADNIFY_FILES.SETTINGS, data)
      this.dirty.settings = false
    }
  }

  async readText(file: AdnifyFile | string, rootPath?: string): Promise<string | null> {
    try {
      return await api.file.read(this.getFilePath(file, rootPath))
    } catch {
      return null
    }
  }

  async writeText(file: AdnifyFile | string, content: string, rootPath?: string): Promise<boolean> {
    try {
      return await api.file.write(this.getFilePath(file, rootPath), content)
    } catch (error) {
      logger.system.error(`[AdnifyDir] Failed to write ${file}:`, error)
      return false
    }
  }

  async readJson<T>(file: AdnifyFile | string, rootPath?: string): Promise<T | null> {
    try {
      const content = await api.file.read(this.getFilePath(file, rootPath))
      if (!content) return null
      return JSON.parse(content) as T
    } catch {
      return null
    }
  }

  async writeJson<T>(file: AdnifyFile | string, data: T, rootPath?: string): Promise<boolean> {
    try {
      const content = JSON.stringify(data, null, 2)
      return await api.file.write(this.getFilePath(file, rootPath), content)
    } catch (error) {
      logger.system.error(`[AdnifyDir] Failed to write ${file}:`, error)
      return false
    }
  }

  async fileExists(file: AdnifyFile | string, rootPath?: string): Promise<boolean> {
    try {
      return await api.file.exists(this.getFilePath(file, rootPath))
    } catch {
      return false
    }
  }

  async deleteFile(file: AdnifyFile | string, rootPath?: string): Promise<boolean> {
    try {
      return await api.file.delete(this.getFilePath(file, rootPath))
    } catch {
      return false
    }
  }

  private async rebuildMetaFromThreadFiles(extra: Record<string, unknown>): Promise<SessionMeta | null> {
    try {
      const sessionsDirPath = this.getFilePath(ADNIFY_FILES.SESSIONS_DIR)
      const entries = await api.file.readDir(sessionsDirPath)
      const threadIds = entries
        .filter(entry => !entry.isDirectory && entry.name.endsWith('.json') && entry.name !== '_meta.json' && entry.name !== '_extra.json')
        .map(entry => entry.name.slice(0, -'.json'.length))
        .sort()

      if (threadIds.length === 0) {
        return null
      }

      const rebuiltMeta: SessionMeta = {
        currentThreadId: threadIds[0],
        threadIds,
        extra,
        version: 0,
      }

      this.setSessionMetaDirty(rebuiltMeta)
      logger.system.warn('[AdnifyDir] Rebuilt missing session meta from thread files:', threadIds.length)
      return rebuiltMeta
    } catch (error) {
      logger.system.error('[AdnifyDir] Failed to rebuild session meta:', error)
      return null
    }
  }

  private async migrateOldSessions(): Promise<void> {
    if (!this.primaryRoot) return

    const oldPath = `${this.getDirPath()}/sessions.json`
    try {
      const exists = await api.file.exists(oldPath)
      if (!exists) return

      const content = await api.file.read(oldPath)
      if (!content) return

      const oldData = JSON.parse(content)
      const storeData = oldData['adnify-agent-store']
      if (!storeData?.state?.threads) {
        await api.file.delete(oldPath)
        return
      }

      const { threads, currentThreadId, ...extra } = storeData.state as Record<string, unknown>
      const threadsMap = threads as Record<string, unknown>
      const threadIds = Object.keys(threadsMap)

      await Promise.all(
        Object.entries(threadsMap).map(([threadId, data]) => this.writeSessionFile(`${threadId}.json`, data))
      )

      const meta: SessionMeta = {
        currentThreadId: currentThreadId as string | null,
        threadIds,
        extra,
        version: storeData.version || 0,
      }

      await Promise.all([
        this.writeSessionFile('_meta.json', toSessionIndexMeta(meta)),
        this.writeSessionFile('_extra.json', meta.extra),
      ])

      await api.file.delete(oldPath)
      logger.system.info(`[AdnifyDir] Migrated sessions.json → sessions/ (${threadIds.length} threads)`)
    } catch (error) {
      logger.system.error('[AdnifyDir] Sessions migration failed:', error)
    }
  }

  private async loadAllData(): Promise<void> {
    const [sessionMeta, workspaceState, settings] = await Promise.all([
      this.getSessionMeta(),
      this.readJsonFile<WorkspaceStateData>(ADNIFY_FILES.WORKSPACE_STATE),
      this.readJsonFile<ProjectSettingsData>(ADNIFY_FILES.SETTINGS),
    ])
    this.cache.sessionMeta = sessionMeta || { ...DEFAULT_SESSION_META }
    this.metaHash = stableStringify(this.cache.sessionMeta)
    this.cache.workspaceState = workspaceState || { ...DEFAULT_WORKSPACE_STATE }
    this.cache.settings = settings ? { ...DEFAULT_PROJECT_SETTINGS, ...settings } : { ...DEFAULT_PROJECT_SETTINGS }
    logger.system.info('[AdnifyDir] Loaded all data from disk')
  }

  private async readSessionFile<T>(fileName: string): Promise<T | null> {
    try {
      const filePath = `${this.getDirPath()}/${ADNIFY_FILES.SESSIONS_DIR}/${fileName}`
      const content = await api.file.read(filePath)
      if (!content) return null
      return JSON.parse(content) as T
    } catch {
      return null
    }
  }

  private async writeSessionFile<T>(fileName: string, data: T): Promise<void> {
    try {
      const filePath = `${this.getDirPath()}/${ADNIFY_FILES.SESSIONS_DIR}/${fileName}`
      const content = JSON.stringify(data, null, 2)
      await api.file.write(filePath, content)
    } catch (error) {
      logger.system.error(`[AdnifyDir] Failed to write session file ${fileName}:`, error)
    }
  }

  private async readJsonFile<T>(file: AdnifyFile): Promise<T | null> {
    return this.readJson<T>(file)
  }

  private async writeJsonFile<T>(file: AdnifyFile, data: T): Promise<void> {
    await this.writeJson(file, data)
  }
}

export const adnifyDir = new AdnifyDirService()
export { DEFAULT_PROJECT_SETTINGS, DEFAULT_WORKSPACE_STATE }
