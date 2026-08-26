/** Workspace-owned files that intentionally remain portable with the project. */
import { api } from '@/renderer/services/electronAPI'
import type { OpenPreviewMetadata } from '@shared/types/preview'
import { BufferedCommitQueue } from '@shared/persistence/BufferedCommitQueue'
import { logger } from '@utils/Logger'
import { getEditorConfig } from '@renderer/settings'
import { persistenceCoordinator } from './persistence/PersistenceCoordinator'
import type { EditorDocumentKind } from '@shared/types/editorDocument'

export const ADNIFY_DIR_NAME = '.adnify'

export const ADNIFY_FILES = {
  INDEX_DIR: 'index',
  STATS_DIR: 'stats',
  AI_STATS_DIR: 'ai-stats',
  SETTINGS: 'settings.json',
  WORKSPACE_STATE: 'workspace-state.json',
  RULES: 'rules.md',
} as const

type AdnifyFile = typeof ADNIFY_FILES[keyof typeof ADNIFY_FILES]

export interface WorkspaceStateData {
  openFiles: Array<string | {
    path: string
    kind?: EditorDocumentKind
    preview?: OpenPreviewMetadata
  }>
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
  checkpointRetention: { maxCount: 50, maxAgeDays: 7, maxFileSizeKB: 100 },
  logging: { level: 'info', saveToFile: false },
  agent: { autoApproveReadOnly: true, maxToolCallsPerTurn: 25 },
}

class WorkspaceFileRepository {
  private primaryRoot: string | null = null
  private readonly initializedRoots = new Set<string>()
  private workspaceState: WorkspaceStateData | null = null
  private settings: ProjectSettingsData | null = null

  private readonly workspaceStateCommits = new BufferedCommitQueue<WorkspaceStateData>({
    delayMs: getEditorConfig().performance.flushIntervalMs,
    commit: state => this.writeJsonFile(ADNIFY_FILES.WORKSPACE_STATE, state),
    onBackgroundError: error => logger.system.error('[WorkspaceFiles] State commit failed:', error),
  })

  private readonly settingsCommits = new BufferedCommitQueue<ProjectSettingsData>({
    delayMs: getEditorConfig().performance.flushIntervalMs,
    commit: settings => this.writeJsonFile(ADNIFY_FILES.SETTINGS, settings),
    onBackgroundError: error => logger.system.error('[WorkspaceFiles] Settings commit failed:', error),
  })

  async initialize(rootPath: string): Promise<boolean> {
    if (this.initializedRoots.has(rootPath)) return true
    try {
      const root = `${rootPath}/${ADNIFY_DIR_NAME}`
      await api.file.ensureDir(root)
      await Promise.all([
        api.file.ensureDir(`${root}/${ADNIFY_FILES.INDEX_DIR}`),
        api.file.ensureDir(`${root}/${ADNIFY_FILES.STATS_DIR}`),
        api.file.ensureDir(`${root}/${ADNIFY_FILES.AI_STATS_DIR}`),
      ])
      this.initializedRoots.add(rootPath)
      return true
    } catch (error) {
      logger.system.error('[WorkspaceFiles] Initialization failed:', rootPath, error)
      return false
    }
  }

  async setPrimaryRoot(rootPath: string): Promise<void> {
    if (this.primaryRoot === rootPath) return
    await this.flush()
    if (!await this.initialize(rootPath)) {
      throw new Error(`Unable to initialize workspace storage: ${rootPath}`)
    }
    this.primaryRoot = rootPath
    this.workspaceState = null
    this.settings = null
  }

  reset(): void {
    this.workspaceStateCommits.discard()
    this.settingsCommits.discard()
    this.primaryRoot = null
    this.initializedRoots.clear()
    this.workspaceState = null
    this.settings = null
  }

  isInitialized(): boolean {
    return this.primaryRoot !== null
  }

  getPrimaryRoot(): string | null {
    return this.primaryRoot
  }

  getDirPath(rootPath?: string): string {
    const targetRoot = rootPath || this.primaryRoot
    if (!targetRoot) throw new Error('[WorkspaceFiles] No primary workspace')
    return `${targetRoot}/${ADNIFY_DIR_NAME}`
  }

  getFilePath(file: AdnifyFile | string, rootPath?: string): string {
    return `${this.getDirPath(rootPath)}/${file}`
  }

  /**
   * Resolves a path for an IO call, or null when no workspace is bound.
   *
   * Closing a workspace clears `primaryRoot` synchronously while buffered
   * writers may still have a flush in flight, so IO that lands after the reset
   * reports failure through its normal return value instead of rejecting.
   */
  private resolveIoPath(file: AdnifyFile | string, rootPath?: string): string | null {
    if (!rootPath && !this.primaryRoot) {
      logger.system.debug('[WorkspaceFiles] Dropped IO with no workspace bound:', file)
      return null
    }
    return this.getFilePath(file, rootPath)
  }

  async getWorkspaceState(): Promise<WorkspaceStateData> {
    if (this.workspaceState) return this.workspaceState
    this.workspaceState = await this.readJsonFile<WorkspaceStateData>(ADNIFY_FILES.WORKSPACE_STATE)
      || { ...DEFAULT_WORKSPACE_STATE }
    return this.workspaceState
  }

  async saveWorkspaceState(state: WorkspaceStateData): Promise<void> {
    this.workspaceState = state
    this.workspaceStateCommits.stage(state)
  }

  async getSettings(): Promise<ProjectSettingsData> {
    if (this.settings) return this.settings
    this.settings = await this.readJsonFile<ProjectSettingsData>(ADNIFY_FILES.SETTINGS)
      || { ...DEFAULT_PROJECT_SETTINGS }
    return this.settings
  }

  async saveSettings(settings: ProjectSettingsData): Promise<void> {
    this.settings = settings
    this.settingsCommits.stage(settings)
  }

  async readText(file: AdnifyFile | string, rootPath?: string): Promise<string | null> {
    const target = this.resolveIoPath(file, rootPath)
    if (!target) return null
    return api.file.readFull(target)
  }

  async writeText(file: AdnifyFile | string, content: string, rootPath?: string): Promise<boolean> {
    const target = this.resolveIoPath(file, rootPath)
    if (!target) return false
    return api.file.write(target, content)
  }

  async appendText(file: AdnifyFile | string, content: string, rootPath?: string): Promise<boolean> {
    const target = this.resolveIoPath(file, rootPath)
    if (!target) return false
    return api.file.append(target, content)
  }

  async exists(file: AdnifyFile | string, rootPath?: string): Promise<boolean> {
    const target = this.resolveIoPath(file, rootPath)
    if (!target) return false
    return api.file.exists(target)
  }

  async delete(file: AdnifyFile | string, rootPath?: string): Promise<boolean> {
    const target = this.resolveIoPath(file, rootPath)
    if (!target) return false
    return api.file.delete(target)
  }

  async flush(): Promise<void> {
    await Promise.all([
      this.workspaceStateCommits.flush(),
      this.settingsCommits.flush(),
    ])
  }

  private async readJsonFile<T>(file: AdnifyFile): Promise<T | null> {
    const content = await this.readText(file)
    if (!content) return null
    try {
      return JSON.parse(content) as T
    } catch (error) {
      logger.system.error(`[WorkspaceFiles] Invalid JSON in ${file}:`, error)
      throw error
    }
  }

  private async writeJsonFile<T>(file: AdnifyFile, data: T): Promise<void> {
    // No workspace bound means the workspace closed while this commit was
    // buffered. Dropping it is correct: throwing would leave the value pending
    // in the commit queue, which retries it forever against a null root.
    if (!this.primaryRoot) {
      logger.system.debug('[WorkspaceFiles] Dropped buffered commit after workspace close:', file)
      return
    }
    const written = await this.writeText(file, JSON.stringify(data, null, 2))
    if (!written) throw new Error(`Failed to write workspace file: ${file}`)
  }
}

export const workspaceFiles = new WorkspaceFileRepository()
persistenceCoordinator.register({
  id: 'workspace-files',
  scope: 'workspace',
  flush: () => workspaceFiles.flush(),
})
