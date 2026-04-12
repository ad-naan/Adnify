/**
 * .adnify 目录统一管理服务
 *
 * 所有项目级数据都存储在 .adnify 目录下：
 * .adnify/
 *   ├── index/               # 代码库向量索引
 *   ├── sessions/            # Agent 会话（按线程拆分）
 *   │   ├── _meta.json       # 线程索引元数据（currentThreadId, threadIds, version）
 *   │   ├── _extra.json      # 非线程状态（branches 等）
 *   │   └── {threadId}.jsonl # 单个线程消息数据
 *   ├── settings.json        # 项目级设置
 *   ├── workspace-state.json # 工作区状态（打开的文件等）
 *   └── rules.md             # 项目 AI 规则
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { getEditorConfig } from '@renderer/settings'
import {
  fromPersistedChatThread,
  toPersistedChatThread,
  type ChatThread,
  type PersistedChatThread,
} from '@/renderer/agent/types'

export const ADNIFY_DIR_NAME = '.adnify'

export const ADNIFY_FILES = {
  INDEX_DIR: 'index',
  SESSIONS_DIR: 'sessions',
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

interface SessionExtraState {
  branches: Record<string, unknown>
  activeBranchId: Record<string, string | null>
}

interface LegacyAgentStoreEnvelope {
  state?: {
    threads?: Record<string, unknown>
    currentThreadId?: string | null
    branches?: Record<string, unknown>
    activeBranchId?: Record<string, unknown>
  }
  version?: number
}

interface PersistedThreadSummary {
  id: string
  lastModified: number
  messageCount: number
}

interface SessionCatalog {
  meta: SessionMeta
  summaries: PersistedThreadSummary[]
}

export interface SessionMeta extends SessionIndexMeta {
  extra: SessionExtraState
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

export interface AgentSessionSnapshot {
  threads: Record<string, ChatThread>
  currentThreadId: string | null
  branches: Record<string, unknown>
  activeBranchId: Record<string, unknown>
  version: number
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
  extra: {
    branches: {},
    activeBranchId: {},
  },
  version: 0,
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeSessionExtraState(value?: Record<string, unknown> | null): SessionExtraState {
  const rawBranches = isPlainRecord(value?.branches) ? value.branches : {}
  const rawActiveBranchId = isPlainRecord(value?.activeBranchId) ? value.activeBranchId : {}

  const activeBranchId: Record<string, string | null> = {}
  for (const [threadId, branchId] of Object.entries(rawActiveBranchId)) {
    if (typeof branchId === 'string' || branchId === null) {
      activeBranchId[threadId] = branchId
    }
  }

  return {
    branches: { ...rawBranches },
    activeBranchId,
  }
}

function serializeSessionExtraState(extra: SessionExtraState): Record<string, unknown> {
  const serialized: Record<string, unknown> = {}

  if (Object.keys(extra.branches).length > 0) {
    serialized.branches = extra.branches
  }

  if (Object.keys(extra.activeBranchId).length > 0) {
    serialized.activeBranchId = extra.activeBranchId
  }

  return serialized
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

function normalizePersistedChatThread(thread: PersistedChatThread): PersistedChatThread {
  const messages = Array.isArray(thread.messages) ? thread.messages : []
  const preservedMessageCount =
    typeof thread.messageCount === 'number'
      ? thread.messageCount
      : messages.length

  return {
    ...thread,
    messages,
    contextItems: Array.isArray(thread.contextItems) ? thread.contextItems : [],
    messageCheckpoints: Array.isArray(thread.messageCheckpoints) ? thread.messageCheckpoints : [],
    messageCount: preservedMessageCount,
    contextSummary: thread.contextSummary ?? null,
  }
}

function stripThreadMessagesForMetadata(thread: PersistedChatThread): PersistedChatThread {
  return normalizePersistedChatThread({
    ...thread,
    messageCount: typeof thread.messageCount === 'number'
      ? thread.messageCount
      : (Array.isArray(thread.messages) ? thread.messages.length : 0),
    messages: [],
  })
}

function normalizeLegacyThreadRecord(threadId: string, value: unknown): ChatThread | null {
  if (!isPlainRecord(value)) {
    return null
  }

  const messages = Array.isArray(value.messages) ? value.messages : []
  const contextItems = Array.isArray(value.contextItems) ? value.contextItems : []
  const messageCheckpoints = Array.isArray(value.messageCheckpoints) ? value.messageCheckpoints : []
  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : Date.now()
  const lastModified = typeof value.lastModified === 'number' ? value.lastModified : createdAt

  return fromPersistedChatThread({
    id: typeof value.id === 'string' ? value.id : threadId,
    createdAt,
    lastModified,
    messages,
    contextItems,
    messageCheckpoints,
    messageCount: typeof value.messageCount === 'number' ? value.messageCount : messages.length,
    contextSummary: null,
    todos: Array.isArray(value.todos) ? value.todos : undefined,
    handoffContext: typeof value.handoffContext === 'string' ? value.handoffContext : undefined,
    pendingObjective: typeof value.pendingObjective === 'string' ? value.pendingObjective : undefined,
    pendingSteps: Array.isArray(value.pendingSteps) ? value.pendingSteps.filter((step): step is string => typeof step === 'string') : undefined,
    mode: value.mode as PersistedChatThread['mode'],
    origin: value.origin === 'plan-task' ? 'plan-task' : value.origin === 'user' ? 'user' : undefined,
    planId: typeof value.planId === 'string' ? value.planId : undefined,
    taskId: typeof value.taskId === 'string' ? value.taskId : undefined,
  })
}

class AdnifyDirService {
  private primaryRoot: string | null = null
  private initializedRoots: Set<string> = new Set()
  private initialized = false

  private cache: {
    sessionMeta: SessionMeta | null
    threads: Map<string, PersistedChatThread>
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

  async setPrimaryRoot(rootPath: string): Promise<void> {
    logger.system.info('[AdnifyDir] setPrimaryRoot called with:', rootPath)
    logger.system.info('[AdnifyDir] Current primaryRoot:', this.primaryRoot)

    if (this.primaryRoot === rootPath) {
      logger.system.info('[AdnifyDir] Primary root already set, skipping initialization')
      return
    }

    if (this.primaryRoot) {
      await this.flush()
    }

    this.primaryRoot = rootPath
    await this.initialize(rootPath)
    this.cache = { sessionMeta: null, threads: new Map(), workspaceState: null, settings: null }
    this.dirty = { sessionMeta: false, dirtyThreads: new Set(), workspaceState: false, settings: false }
    this.threadHashes.clear()
    this.metaHash = null
    await this.migrateLegacySessionsIfNeeded()
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
        extra: serializeSessionExtraState(this.cache.sessionMeta.extra),
      }
      : null
    const metaRevision = metaToWrite ? ++this.metaWriteRevision : 0

    const promises: Promise<void>[] = []

    if (metaToWrite) {
      promises.push(this.writeSessionFile('_meta.json', metaToWrite.index))
      if (Object.keys(metaToWrite.extra).length > 0) {
        promises.push(this.writeSessionFile('_extra.json', metaToWrite.extra))
      } else {
        promises.push(this.deleteSessionFile('_extra.json'))
      }
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

  private getSessionsDirPath(): string {
    return `${this.getDirPath()}/${ADNIFY_FILES.SESSIONS_DIR}`
  }

  private getLegacySessionsFilePath(): string {
    return this.getFilePath('sessions.json')
  }

  private getSessionFilePath(fileName: string): string {
    return `${this.getSessionsDirPath()}/${fileName}`
  }

  private getThreadMetaPath(threadId: string): string {
    return this.getSessionFilePath(`${threadId}.json`)
  }

  private getThreadMessagesPath(threadId: string): string {
    return this.getSessionFilePath(`${threadId}.jsonl`)
  }

  private async listPersistedThreadSummaries(): Promise<PersistedThreadSummary[]> {
    if (!this.isInitialized()) return []

    try {
      const entries = await api.file.readDir(this.getSessionsDirPath())
      const threadFiles = entries.filter(entry =>
        !entry.isDirectory &&
        entry.name.endsWith('.json') &&
        !entry.name.startsWith('_')
      )

      const summaries = await Promise.all(
        threadFiles.map(async entry => {
          const threadId = entry.name.slice(0, -'.json'.length)
          const data = await this.readSessionFile<PersistedChatThread>(entry.name)
          if (!data) return null

          return {
            id: threadId,
            lastModified: typeof data.lastModified === 'number' ? data.lastModified : 0,
            messageCount: typeof data.messageCount === 'number' ? data.messageCount : 0,
          } satisfies PersistedThreadSummary
        })
      )

      return summaries.filter((item): item is PersistedThreadSummary => item !== null)
    } catch (error) {
      logger.system.error('[AdnifyDir] Failed to list persisted thread summaries:', error)
      return []
    }
  }

  private selectPreferredCurrentThreadId(
    currentThreadId: string | null,
    summaries: PersistedThreadSummary[],
    preferNonEmptyThread: boolean
  ): string | null {
    if (summaries.length === 0) return null

    const summaryById = new Map(summaries.map(summary => [summary.id, summary]))
    const sorted = [...summaries].sort((left, right) => {
      const leftHasMessages = left.messageCount > 0 ? 1 : 0
      const rightHasMessages = right.messageCount > 0 ? 1 : 0
      if (rightHasMessages !== leftHasMessages) {
        return rightHasMessages - leftHasMessages
      }
      if (right.messageCount !== left.messageCount) {
        return right.messageCount - left.messageCount
      }
      return right.lastModified - left.lastModified
    })

    if (currentThreadId) {
      const currentSummary = summaryById.get(currentThreadId)
      if (currentSummary) {
        if (!preferNonEmptyThread || currentSummary.messageCount > 0 || sorted[0]?.messageCount === 0) {
          return currentThreadId
        }
      }
    }

    return sorted[0]?.id || null
  }

  private buildEffectiveSessionMeta(
    meta: SessionMeta,
    summaries: PersistedThreadSummary[]
  ): SessionMeta {
    if (summaries.length === 0) {
      return meta.threadIds.length === 0 && !meta.currentThreadId
        ? meta
        : { ...DEFAULT_SESSION_META, extra: meta.extra }
    }

    const hasNonEmptyThread = summaries.some(summary => summary.messageCount > 0)
    const effectiveSummaries = hasNonEmptyThread
      ? summaries.filter(summary => summary.messageCount > 0)
      : summaries
    const actualThreadIds = effectiveSummaries.map(summary => summary.id).sort()
    const preferredCurrentThreadId = this.selectPreferredCurrentThreadId(
      meta.currentThreadId,
      effectiveSummaries,
      hasNonEmptyThread
    )

    return {
      currentThreadId: preferredCurrentThreadId,
      threadIds: actualThreadIds,
      extra: meta.extra,
      version: meta.version,
    }
  }

  private async buildSessionCatalog(): Promise<SessionCatalog> {
    const [indexMeta, extra, summaries] = await Promise.all([
      this.readSessionFile<SessionIndexMeta>('_meta.json'),
      this.readSessionFile<Record<string, unknown>>('_extra.json'),
      this.listPersistedThreadSummaries(),
    ])

    const hydratedMeta: SessionMeta = {
      currentThreadId: indexMeta?.currentThreadId ?? null,
      threadIds: indexMeta?.threadIds ?? [],
      version: indexMeta?.version ?? 0,
      extra: normalizeSessionExtraState(extra),
    }

    return {
      meta: this.buildEffectiveSessionMeta(hydratedMeta, summaries),
      summaries,
    }
  }

  private async reconcileSessionMeta(meta: SessionMeta): Promise<SessionMeta> {
    const summaries = await this.listPersistedThreadSummaries()
    const reconciledMeta = this.buildEffectiveSessionMeta(meta, summaries)
    const indexedThreadIds = [...meta.threadIds].sort()
    const actualThreadIds = [...reconciledMeta.threadIds].sort()
    const hasThreadSetDrift =
      actualThreadIds.length !== indexedThreadIds.length ||
      actualThreadIds.some((threadId, index) => threadId !== indexedThreadIds[index])
    const hasCurrentThreadDrift = reconciledMeta.currentThreadId !== meta.currentThreadId

    if (!hasThreadSetDrift && !hasCurrentThreadDrift) {
      return meta
    }

    await this.writeSessionFile('_meta.json', toSessionIndexMeta(reconciledMeta))
    this.cache.sessionMeta = reconciledMeta
    this.metaHash = stableStringify(reconciledMeta)
    this.dirty.sessionMeta = false
    logger.system.warn('[AdnifyDir] Reconciled session meta from persisted thread files:', {
      indexedCount: meta.threadIds.length,
      actualCount: actualThreadIds.length,
      currentThreadId: reconciledMeta.currentThreadId,
    })

    return reconciledMeta
  }

  async getSessionMeta(): Promise<SessionMeta> {
    if (this.cache.sessionMeta) return this.cache.sessionMeta
    if (!this.isInitialized()) return { ...DEFAULT_SESSION_META }

    const { meta } = await this.buildSessionCatalog()
    const reconciledMeta = await this.reconcileSessionMeta(meta)

    this.cache.sessionMeta = reconciledMeta
    this.metaHash = stableStringify(reconciledMeta)
    return reconciledMeta
  }

  private parseLegacyAgentSessionSnapshot(content: string): AgentSessionSnapshot | null {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>
      const envelope = isPlainRecord(parsed?.['adnify-agent-store'])
        ? parsed['adnify-agent-store'] as LegacyAgentStoreEnvelope
        : parsed as LegacyAgentStoreEnvelope

      const rawState = isPlainRecord(envelope.state) ? envelope.state : {}
      const rawThreads = isPlainRecord(rawState.threads) ? rawState.threads : {}
      const threads: Record<string, ChatThread> = {}

      for (const [threadId, threadValue] of Object.entries(rawThreads)) {
        const thread = normalizeLegacyThreadRecord(threadId, threadValue)
        if (thread) {
          threads[threadId] = thread
        }
      }

      const threadIds = Object.keys(threads)
      const currentThreadId = typeof rawState.currentThreadId === 'string' && threads[rawState.currentThreadId]
        ? rawState.currentThreadId
        : (threadIds[0] || null)

      if (threadIds.length === 0 && !currentThreadId) {
        return null
      }

      return {
        threads,
        currentThreadId,
        branches: isPlainRecord(rawState.branches) ? rawState.branches : {},
        activeBranchId: isPlainRecord(rawState.activeBranchId) ? rawState.activeBranchId : {},
        version: typeof envelope.version === 'number' ? envelope.version : 0,
      }
    } catch (error) {
      logger.system.error('[AdnifyDir] Failed to parse legacy sessions.json:', error)
      return null
    }
  }

  private async writeAgentSessionSnapshot(snapshot: AgentSessionSnapshot): Promise<void> {
    const normalizedExtra = normalizeSessionExtraState({
      branches: snapshot.branches,
      activeBranchId: snapshot.activeBranchId,
    })
    const threadIds = Object.keys(snapshot.threads)

    await this.writeSessionFile('_meta.json', {
      currentThreadId: snapshot.currentThreadId,
      threadIds,
      version: snapshot.version,
    })

    if (Object.keys(serializeSessionExtraState(normalizedExtra)).length > 0) {
      await this.writeSessionFile('_extra.json', serializeSessionExtraState(normalizedExtra))
    } else {
      await this.deleteSessionFile('_extra.json')
    }

    await Promise.all(
      threadIds.map(async threadId => {
        await this.writeSessionFile(`${threadId}.json`, toPersistedChatThread(snapshot.threads[threadId]))
      })
    )
  }

  private async migrateLegacySessionsIfNeeded(): Promise<void> {
    if (!this.primaryRoot) return

    const legacySessionsPath = this.getLegacySessionsFilePath()
    const [legacyExists, metaExists] = await Promise.all([
      api.file.exists(legacySessionsPath),
      api.file.exists(this.getSessionFilePath('_meta.json')),
    ])

    if (!legacyExists || metaExists) {
      return
    }

    const legacyContent = await api.file.read(legacySessionsPath)
    if (!legacyContent) {
      return
    }

    const snapshot = this.parseLegacyAgentSessionSnapshot(legacyContent)
    if (!snapshot) {
      logger.system.warn('[AdnifyDir] Legacy sessions.json exists but no valid session snapshot was found')
      return
    }

    await this.writeAgentSessionSnapshot(snapshot)
    await api.file.delete(legacySessionsPath).catch(() => { /* ignore */ })
    logger.system.info(`[AdnifyDir] Migrated legacy sessions.json to thread storage (${Object.keys(snapshot.threads).length} threads)`)
  }

  async getThreadData(threadId: string): Promise<PersistedChatThread | null> {
    if (this.cache.threads.has(threadId)) return this.cache.threads.get(threadId)!
    if (!this.isInitialized()) return null
    const data = await this.readSessionFile<PersistedChatThread>(`${threadId}.json`)
    if (data !== null) {
      this.cache.threads.set(threadId, data)
      this.threadHashes.set(threadId, stableStringify(data))
    }
    return data
  }

  /**
   * 按需加载线程消息（懒加载）
   * 从 .jsonl 文件读取消息，不影响缓存的元数据
   */
  async loadThreadMessages(threadId: string): Promise<any[]> {
    if (!this.isInitialized()) return []

    try {
      const jsonlPath = this.getThreadMessagesPath(threadId)
      const jsonlExists = await api.file.exists(jsonlPath)

      if (!jsonlExists) {
        return []
      }

      const jsonlContent = await api.file.read(jsonlPath)
      if (!jsonlContent) return []

      const messages = this.parseMessagesFromJsonl(jsonlContent)
      logger.system.info(`[AdnifyDir] Loaded ${messages.length} messages for thread ${threadId}`)
      return messages
    } catch (error) {
      logger.system.error(`[AdnifyDir] Failed to load messages for thread ${threadId}:`, error)
      return []
    }
  }

  setThreadDirty(threadId: string, data: PersistedChatThread): void {
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
        await Promise.all([
          api.file.delete(this.getThreadMetaPath(threadId)).catch(() => { }),
          api.file.delete(this.getThreadMessagesPath(threadId)).catch(() => { }),
        ])
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
        await Promise.all([
          api.file.delete(this.getThreadMetaPath(threadId)).catch(() => { }),
          api.file.delete(this.getThreadMessagesPath(threadId)).catch(() => { }),
        ])
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
      this.deleteSessionFile('_extra.json'),
    ])
  }

  async getAgentSessionSnapshot(): Promise<AgentSessionSnapshot | null> {
    const { meta, summaries } = await this.buildSessionCatalog()
    const reconciledMeta = await this.reconcileSessionMeta(meta)

    if (reconciledMeta.threadIds.length === 0 && !reconciledMeta.currentThreadId) {
      this.cache.sessionMeta = reconciledMeta
      this.metaHash = stableStringify(reconciledMeta)
      return null
    }

    this.cache.sessionMeta = reconciledMeta
    this.metaHash = stableStringify(reconciledMeta)

    const effectiveMeta = this.buildEffectiveSessionMeta(reconciledMeta, summaries)

    const threadEntries = await Promise.all(
      effectiveMeta.threadIds.map(async threadId => [threadId, await this.getThreadData(threadId)] as const)
    )

    const threads: Record<string, ChatThread> = {}
    for (const [threadId, data] of threadEntries) {
      if (data !== null) {
        threads[threadId] = fromPersistedChatThread(data)
      }
    }

    // 立即加载当前线程的消息（阻塞加载，确保 UI 渲染前消息已就绪）
    const currentThreadId = effectiveMeta.currentThreadId
    if (currentThreadId && threads[currentThreadId]) {
      const threadData = threads[currentThreadId] as ChatThread
      // 只有当消息为空时才加载（避免重复加载）
      if (!threadData.messages || threadData.messages.length === 0) {
        const messages = await this.loadThreadMessages(currentThreadId)
        threadData.messages = messages
        threadData.messageCount = messages.length
      }
    }

    return {
      threads,
      currentThreadId: effectiveMeta.currentThreadId,
      branches: effectiveMeta.extra.branches,
      activeBranchId: effectiveMeta.extra.activeBranchId,
      version: effectiveMeta.version,
    }
  }

  async getAgentSessionSnapshotWithoutHydration(): Promise<AgentSessionSnapshot | null> {
    const { meta, summaries } = await this.buildSessionCatalog()
    const reconciledMeta = await this.reconcileSessionMeta(meta)

    if (reconciledMeta.threadIds.length === 0 && !reconciledMeta.currentThreadId) {
      this.cache.sessionMeta = reconciledMeta
      this.metaHash = stableStringify(reconciledMeta)
      return null
    }

    this.cache.sessionMeta = reconciledMeta
    this.metaHash = stableStringify(reconciledMeta)

    const effectiveMeta = this.buildEffectiveSessionMeta(reconciledMeta, summaries)
    const threadEntries = await Promise.all(
      effectiveMeta.threadIds.map(async threadId => [threadId, await this.getThreadData(threadId)] as const)
    )

    const threads: Record<string, ChatThread> = {}
    for (const [threadId, data] of threadEntries) {
      if (data !== null) {
        threads[threadId] = fromPersistedChatThread(data)
      }
    }

    return {
      threads,
      currentThreadId: effectiveMeta.currentThreadId,
      branches: effectiveMeta.extra.branches,
      activeBranchId: effectiveMeta.extra.activeBranchId,
      version: effectiveMeta.version,
    }
  }

  stageAgentSessionSnapshot(snapshot: AgentSessionSnapshot): void {
    const threads = snapshot.threads || {}
    const currentThreadId = snapshot.currentThreadId
    const extra = normalizeSessionExtraState({
      branches: snapshot.branches,
      activeBranchId: snapshot.activeBranchId,
    })

    this.setSessionMetaDirty({
      currentThreadId,
      threadIds: Object.keys(threads),
      extra,
      version: snapshot.version || 0,
    })

    for (const [threadId, data] of Object.entries(threads)) {
      const threadData = toPersistedChatThread(data)
      const messages = threadData.messages
      // 非当前线程且 messages 为空时，说明是懒加载占位符（还未从磁盘读取）
      // 只更新内存缓存，不标记 dirty，避免调度 flush 用空数组覆盖磁盘上的真实 JSONL 消息
      if (threadId !== currentThreadId && messages.length === 0) {
        this.cache.threads.set(threadId, threadData)
        continue
      }
      this.setThreadDirty(threadId, threadData)
    }

    for (const cachedId of [...this.cache.threads.keys()]) {
      if (!Object.prototype.hasOwnProperty.call(threads, cachedId)) {
        this.cache.threads.delete(cachedId)
        this.dirty.dirtyThreads.delete(cachedId)
        this.threadHashes.delete(cachedId)
        if (this.isInitialized()) {
          // Bug 5 fix: 同时删除 .json 和 .jsonl，防止孤儿文件泄漏
          api.file.delete(this.getThreadMetaPath(cachedId)).catch(() => { /* ignore */ })
          api.file.delete(this.getThreadMessagesPath(cachedId)).catch(() => { /* ignore */ })
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
      const filePath = this.getSessionFilePath(fileName)
      const content = await api.file.read(filePath)
      if (!content) return null

      if (fileName.endsWith('.json') && !fileName.startsWith('_')) {
        return stripThreadMessagesForMetadata(
          JSON.parse(content) as PersistedChatThread
        ) as T
      }

      return JSON.parse(content) as T
    } catch {
      return null
    }
  }

  private async deleteSessionFile(fileName: string): Promise<void> {
    try {
      const filePath = this.getSessionFilePath(fileName)
      const exists = await api.file.exists(filePath)
      if (exists) {
        await api.file.delete(filePath)
      }
    } catch (error) {
      logger.system.error(`[AdnifyDir] Failed to delete session file ${fileName}:`, error)
    }
  }

  private async writeSessionFile<T>(fileName: string, data: T): Promise<void> {
    try {
      if (fileName.endsWith('.json') && !fileName.startsWith('_')) {
        const threadId = fileName.replace('.json', '')
        const threadData = normalizePersistedChatThread(data as PersistedChatThread)
        const { messages, ...metadata } = threadData

        await api.file.write(
          this.getThreadMetaPath(threadId),
          JSON.stringify(
            {
              ...metadata,
              messageCount: messages.length,
            },
            null,
            2
          )
        )

        if (messages.length > 0) {
          await api.file.write(this.getThreadMessagesPath(threadId), this.serializeMessages(messages))
        } else {
          await this.deleteSessionFile(`${threadId}.jsonl`)
        }

        return
      }

      await api.file.write(this.getSessionFilePath(fileName), JSON.stringify(data, null, 2))
    } catch (error) {
      logger.system.error(`[AdnifyDir] Failed to write session file ${fileName}:`, error)
    }
  }

  private serializeMessages(messages: any[]): string {
    if (messages.length === 0) return ''
    return messages.map(message => JSON.stringify(message)).join('\n')
  }

  private parseMessagesFromJsonl(content: string): any[] {
    if (!content.trim()) return []

    const messages: any[] = []
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        messages.push(JSON.parse(trimmed))
      } catch (error) {
        logger.system.warn('[AdnifyDir] Skipped invalid JSONL line', error)
      }
    }
    return messages
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
