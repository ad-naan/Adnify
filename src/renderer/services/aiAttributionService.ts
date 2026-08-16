import { api } from '@/renderer/services/electronAPI'
import { adnifyDir } from './adnifyDirService'
import { useStore, type WorkspaceConfig } from '@store'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { logger } from '@utils/Logger'
import { getDirname, getFileName, joinPath, normalizePath, pathStartsWith, toRelativePath } from '@shared/utils/pathUtils'
import { diffLines, parsePatch } from 'diff'

const AI_STATS_DIR = 'ai-stats'
const WRITE_EVENTS_FILE = `${AI_STATS_DIR}/write-events.jsonl`
const COMMIT_REPORTS_DIR = `${AI_STATS_DIR}/commit-reports`
const HOOK_MARKER_START = '# >>> Adnify AI attribution >>>'
const HOOK_MARKER_END = '# <<< Adnify AI attribution <<<'
const HOOK_PENDING_DIR = 'adnify-ai'
const HOOK_PENDING_FILE = `${HOOK_PENDING_DIR}/pending-commits.jsonl`
const NOTES_REF = 'adnify-ai'
const AI_EDIT_SIMILARITY_THRESHOLD = 0.55
const MAX_RECENT_COMMITS = 6
const MAX_TOP_FILES = 8
const MAX_MODEL_BREAKDOWN = 8

export interface AiCandidateBlock {
  blockId: string
  relativePath: string
  startLine: number
  endLine: number
  lineHashes: string[]
  lines: string[]
  preview: string
  prevAnchorHash?: string
  nextAnchorHash?: string
}

export interface AiWriteEvent {
  version: 1
  eventId: string
  timestamp: number
  repoRoot: string
  branch: string
  workspaceRoot: string
  filePath: string
  relativePath: string
  toolName: string
  toolCallId?: string
  threadId?: string
  assistantId?: string
  requestId?: string
  provider?: string
  modelId?: string
  preHash: string
  postHash: string
  linesAdded: number
  linesRemoved: number
  preview: string
  aiBlocks: AiCandidateBlock[]
}

export interface AiCommitFileSummary {
  path: string
  totalAddedLines: number
  pureAiLines: number
  aiModifiedLines: number
  humanLines: number
}

export interface AiCommitModelSummary {
  provider: string
  modelId: string
  pureAiLines: number
  aiModifiedLines: number
}

export interface AiCommitEventRef {
  eventId: string
  pureAiLines: number
  aiModifiedLines: number
}

export interface AiCommitReport {
  version: 1
  commitSha: string
  shortSha: string
  parentSha: string | null
  branch: string
  repoRoot: string
  repoKey: string
  message: string
  author: string
  timestamp: number
  source: 'commit' | 'reconcile'
  totals: {
    totalAddedLines: number
    pureAiLines: number
    aiModifiedLines: number
    humanLines: number
    aiAssistedShare: number
    pureAiShare: number
  }
  fileBreakdown: AiCommitFileSummary[]
  modelBreakdown: AiCommitModelSummary[]
  eventRefs: AiCommitEventRef[]
}

export interface AiHookStatus {
  installed: boolean
  pendingCount: number
}

export interface AiBranchFileSummary extends AiCommitFileSummary {}

export interface AiBranchModelSummary extends AiCommitModelSummary {}

export interface AiDashboardData {
  available: boolean
  repoName: string
  repoRoot: string | null
  branch: string | null
  baseRef: string | null
  hook: AiHookStatus
  overview: {
    totalAddedLines: number
    pureAiLines: number
    aiModifiedLines: number
    humanLines: number
    aiAssistedShare: number
    pureAiShare: number
  }
  recentCommits: AiCommitReport[]
  modelBreakdown: AiBranchModelSummary[]
  topFiles: AiBranchFileSummary[]
  pendingCommits: string[]
  lastCommit: AiCommitReport | null
}

export const EMPTY_AI_DASHBOARD_DATA: AiDashboardData = {
  available: false,
  repoName: '',
  repoRoot: null,
  branch: null,
  baseRef: null,
  hook: {
    installed: false,
    pendingCount: 0,
  },
  overview: {
    totalAddedLines: 0,
    pureAiLines: 0,
    aiModifiedLines: 0,
    humanLines: 0,
    aiAssistedShare: 0,
    pureAiShare: 0,
  },
  recentCommits: [],
  modelBreakdown: [],
  topFiles: [],
  pendingCommits: [],
  lastCommit: null,
}

interface RepoContext {
  repoRoot: string
  branch: string
  workspaceRoot: string
  repoKey: string
}

interface AddedCommitLine {
  path: string
  lineNumber: number
  content: string
  hunkContextHashes: string[]
}

interface CandidateLine {
  lineId: string
  eventId: string
  timestamp: number
  path: string
  content: string
  hash: string
  provider?: string
  modelId?: string
  prevAnchorHash?: string
  nextAnchorHash?: string
}

interface ClassifiedCommitLine {
  kind: 'pure_ai' | 'ai_modified' | 'human'
  path: string
  provider?: string
  modelId?: string
  eventId?: string
}

function hashText(input: string): string {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function hashLine(line: string): string {
  return hashText(`line:${line}`)
}

function splitLines(content: string): string[] {
  if (!content) return []
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

function trimLinePreview(line: string): string {
  return line.length > 400 ? `${line.slice(0, 397)}...` : line
}

function buildPreview(lines: string[]): string {
  const joined = lines.slice(0, 12).join('\n')
  return joined.length > 800 ? `${joined.slice(0, 797)}...` : joined
}

function buildRepoKey(repoRoot: string): string {
  const name = getFileName(repoRoot) || 'repo'
  const safe = name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'repo'
  return `${safe}-${hashText(normalizePath(repoRoot)).slice(0, 8)}`
}

function safeParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function formatJsonl(lines: unknown[]): string {
  if (lines.length === 0) return ''
  return `${lines.map(line => JSON.stringify(line)).join('\n')}\n`
}

function coerceBranchName(value: string | null | undefined): string {
  if (!value || value === 'HEAD') return 'HEAD'
  return value
}

function normalizeSimilarity(left: string, right: string): number {
  if (left === right) return 1
  if (!left || !right) return 0

  const a = left.slice(0, 300)
  const b = right.slice(0, 300)
  const rows = a.length + 1
  const cols = b.length + 1
  const costs = Array.from({ length: cols }, (_, index) => index)

  for (let row = 1; row < rows; row += 1) {
    let prev = row - 1
    costs[0] = row
    for (let col = 1; col < cols; col += 1) {
      const temp = costs[col]
      const next = a[row - 1] === b[col - 1]
        ? prev
        : Math.min(prev + 1, costs[col] + 1, costs[col - 1] + 1)
      prev = temp
      costs[col] = next
    }
  }

  const distance = costs[cols - 1]
  return 1 - (distance / Math.max(a.length, b.length, 1))
}

function listContextHashes(lines: string[]): string[] {
  return lines
    .filter(line => line.startsWith(' '))
    .map(line => hashLine(line.slice(1)))
}

export function createAiCandidateBlocks(
  oldContent: string,
  newContent: string,
  relativePath: string,
): AiCandidateBlock[] {
  const changes = diffLines(oldContent, newContent)
  const blocks: AiCandidateBlock[] = []
  let newLineCursor = 1
  let lastContextLine: string | null = null

  for (let index = 0; index < changes.length; index += 1) {
    const part = changes[index]
    const lines = splitLines(part.value)
    const actualLines = part.value.endsWith('\n') ? lines.slice(0, -1) : lines

    if (part.added && actualLines.length > 0) {
      let nextContextLine: string | null = null
      for (let lookahead = index + 1; lookahead < changes.length; lookahead += 1) {
        const candidate = changes[lookahead]
        if (candidate.removed) {
          continue
        }
        const candidateLines = splitLines(candidate.value)
        const actualCandidateLines = candidate.value.endsWith('\n') ? candidateLines.slice(0, -1) : candidateLines
        nextContextLine = actualCandidateLines.find(line => line.length > 0) || null
        if (nextContextLine) {
          break
        }
      }

      const startLine = newLineCursor
      const endLine = startLine + actualLines.length - 1
      blocks.push({
        blockId: crypto.randomUUID(),
        relativePath,
        startLine,
        endLine,
        lineHashes: actualLines.map(hashLine),
        lines: actualLines.map(trimLinePreview),
        preview: buildPreview(actualLines.map(trimLinePreview)),
        prevAnchorHash: lastContextLine ? hashLine(lastContextLine) : undefined,
        nextAnchorHash: nextContextLine ? hashLine(nextContextLine) : undefined,
      })
      newLineCursor += actualLines.length
      continue
    }

    if (!part.removed) {
      if (actualLines.length > 0) {
        newLineCursor += actualLines.length
        lastContextLine = actualLines[actualLines.length - 1] || lastContextLine
      }
    }
  }

  return blocks
}

export function parseAddedCommitLinesFromPatch(patchText: string): AddedCommitLine[] {
  const files = parsePatch(patchText)
  const lines: AddedCommitLine[] = []

  for (const file of files) {
    const rawPath = file.newFileName || file.oldFileName || ''
    const path = rawPath.replace(/^b\//, '').replace(/^a\//, '')
    for (const hunk of file.hunks || []) {
      let currentLine = hunk.newStart
      const hunkContextHashes = listContextHashes(hunk.lines || [])
      for (const line of hunk.lines || []) {
        if (line.startsWith('+')) {
          lines.push({
            path,
            lineNumber: currentLine,
            content: line.slice(1),
            hunkContextHashes,
          })
          currentLine += 1
          continue
        }

        if (line.startsWith(' ')) {
          currentLine += 1
        }
      }
    }
  }

  return lines
}

export function classifyCommitAddedLines(
  addedLines: AddedCommitLine[],
  events: AiWriteEvent[],
  threshold: number = AI_EDIT_SIMILARITY_THRESHOLD,
): ClassifiedCommitLine[] {
  const candidateLines = events
    .flatMap(event => event.aiBlocks.flatMap(block => block.lineHashes.map((hash, lineIndex): CandidateLine => ({
      lineId: `${event.eventId}:${block.blockId}:${lineIndex}`,
      eventId: event.eventId,
      timestamp: event.timestamp,
      path: block.relativePath,
      content: block.lines[lineIndex] || '',
      hash,
      provider: event.provider,
      modelId: event.modelId,
      prevAnchorHash: block.prevAnchorHash,
      nextAnchorHash: block.nextAnchorHash,
    }))))
    .sort((left, right) => right.timestamp - left.timestamp)

  const exactPool = new Map<string, CandidateLine[]>()
  const fuzzyPool = new Map<string, CandidateLine[]>()
  for (const candidate of candidateLines) {
    const exactKey = `${candidate.path}::${candidate.hash}`
    const exactEntries = exactPool.get(exactKey) || []
    exactEntries.push(candidate)
    exactPool.set(exactKey, exactEntries)

    const fuzzyEntries = fuzzyPool.get(candidate.path) || []
    fuzzyEntries.push(candidate)
    fuzzyPool.set(candidate.path, fuzzyEntries)
  }

  const consumed = new Set<string>()
  return addedLines.map((line): ClassifiedCommitLine => {
    const exactKey = `${line.path}::${hashLine(line.content)}`
    const exactCandidates = exactPool.get(exactKey) || []
    const exactMatch = exactCandidates.find(candidate => !consumed.has(candidate.lineId))
    if (exactMatch) {
      consumed.add(exactMatch.lineId)
      return {
        kind: 'pure_ai',
        path: line.path,
        provider: exactMatch.provider,
        modelId: exactMatch.modelId,
        eventId: exactMatch.eventId,
      }
    }

    const fuzzyCandidates = (fuzzyPool.get(line.path) || []).filter(candidate => !consumed.has(candidate.lineId))
    let best: { candidate: CandidateLine; score: number } | null = null

    for (const candidate of fuzzyCandidates) {
      const similarity = normalizeSimilarity(candidate.content, line.content)
      const anchorScore = Number(Boolean(candidate.prevAnchorHash && line.hunkContextHashes.includes(candidate.prevAnchorHash)))
        + Number(Boolean(candidate.nextAnchorHash && line.hunkContextHashes.includes(candidate.nextAnchorHash)))
      const score = similarity + (anchorScore * 0.15)

      if (similarity >= threshold && (!best || score > best.score)) {
        best = { candidate, score }
      }
    }

    if (best && (best.score >= threshold || normalizeSimilarity(best.candidate.content, line.content) >= 0.8)) {
      consumed.add(best.candidate.lineId)
      return {
        kind: 'ai_modified',
        path: line.path,
        provider: best.candidate.provider,
        modelId: best.candidate.modelId,
        eventId: best.candidate.eventId,
      }
    }

    return {
      kind: 'human',
      path: line.path,
    }
  })
}

class AiAttributionService {
  private workspaceRoot: string | null = null
  private workspaceKey: string | null = null
  private eventQueue: AiWriteEvent[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private flushPromise: Promise<void> | null = null
  private eventsCache: AiWriteEvent[] | null = null
  private dashboardCache = new Map<string, AiDashboardData>()
  private commitReportCache = new Map<string, AiCommitReport | null>()
  private pendingCommitReportReads = new Map<string, Promise<AiCommitReport | null>>()

  async bindWorkspace(workspace: WorkspaceConfig | null): Promise<void> {
    const nextRoot = workspace?.roots?.[0] || null
    const nextKey = workspace?.roots?.join('|') || null

    if (!nextRoot || !nextKey) {
      await this.flush()
      this.reset()
      return
    }

    if (this.workspaceRoot === nextRoot && this.workspaceKey === nextKey) {
      return
    }

    await this.flush()
    this.workspaceRoot = nextRoot
    this.workspaceKey = nextKey
    this.eventsCache = null
    this.dashboardCache.clear()
    this.commitReportCache.clear()
    this.pendingCommitReportReads.clear()
    await this.ensureStoragePaths()
    await this.reconcileWorkspaceRepos().catch(error => {
      logger.system.warn('[AiAttribution] Failed to reconcile workspace repos on bind:', error)
    })
  }

  reset(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.workspaceRoot = null
    this.workspaceKey = null
    this.eventQueue = []
    this.eventsCache = null
    this.dashboardCache.clear()
    this.commitReportCache.clear()
    this.pendingCommitReportReads.clear()
  }

  async flush(): Promise<void> {
    if (!this.workspaceRoot || this.eventQueue.length === 0) {
      if (this.flushTimer) {
        clearTimeout(this.flushTimer)
        this.flushTimer = null
      }
      return
    }

    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    if (this.flushPromise) {
      await this.flushPromise
      return
    }

    const pending = [...this.eventQueue]
    this.eventQueue = []

    this.flushPromise = (async () => {
      try {
        await this.ensureStoragePaths()
        const existing = await adnifyDir.readText(WRITE_EVENTS_FILE)
        const nextLines = pending.map(event => JSON.stringify(event)).join('\n')
        const nextContent = existing && existing.trim().length > 0
          ? `${existing.trimEnd()}\n${nextLines}\n`
          : `${nextLines}\n`
        await adnifyDir.writeText(WRITE_EVENTS_FILE, nextContent)
        this.eventsCache = this.eventsCache ? [...this.eventsCache, ...pending] : null
        this.dashboardCache.clear()
      } catch (error) {
        logger.system.warn('[AiAttribution] Failed to flush write events:', error)
        this.eventQueue.unshift(...pending)
      } finally {
        this.flushPromise = null
      }
    })()

    await this.flushPromise
  }

  async recordWriteEvent(input: {
    workspacePath: string | null
    filePath: string
    toolName: string
    toolCallId?: string
    threadId?: string | null
    assistantId?: string | null
    requestId?: string
    oldContent: string
    newContent: string
    preHash: string
    postHash: string
    linesAdded: number
    linesRemoved: number
  }): Promise<void> {
    const repoContext = await this.resolveRepoContext(input.workspacePath, input.filePath)
    if (!repoContext) {
      return
    }

    const aiBlocks = createAiCandidateBlocks(input.oldContent, input.newContent, toRelativePath(input.filePath, repoContext.repoRoot))
    const responseMeta = this.lookupAssistantResponseMeta(input.threadId || undefined, input.assistantId || undefined)

    const event: AiWriteEvent = {
      version: 1,
      eventId: crypto.randomUUID(),
      timestamp: Date.now(),
      repoRoot: repoContext.repoRoot,
      branch: repoContext.branch,
      workspaceRoot: repoContext.workspaceRoot,
      filePath: input.filePath,
      relativePath: toRelativePath(input.filePath, repoContext.repoRoot),
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      threadId: input.threadId || undefined,
      assistantId: input.assistantId || undefined,
      requestId: responseMeta?.requestId || input.requestId,
      provider: responseMeta?.provider,
      modelId: responseMeta?.modelId,
      preHash: input.preHash,
      postHash: input.postHash,
      linesAdded: input.linesAdded,
      linesRemoved: input.linesRemoved,
      preview: buildPreview(splitLines(input.newContent).slice(0, 20).map(trimLinePreview)),
      aiBlocks,
    }

    this.eventQueue.push(event)
    this.dashboardCache.clear()
    this.scheduleFlush()
  }

  async attachAssistantResponseMeta(input: {
    threadId?: string | null
    assistantId?: string | null
    provider: string
    modelId: string
    requestId?: string
  }): Promise<void> {
    const threadId = input.threadId || undefined
    const assistantId = input.assistantId || undefined
    if (!threadId || !assistantId) {
      return
    }

    let changed = false
    for (const event of this.eventQueue) {
      if (event.threadId === threadId && event.assistantId === assistantId) {
        if (!event.provider) {
          event.provider = input.provider
          changed = true
        }
        if (!event.modelId) {
          event.modelId = input.modelId
          changed = true
        }
        if (!event.requestId && input.requestId) {
          event.requestId = input.requestId
          changed = true
        }
      }
    }

    const persistedEvents = await this.readWriteEvents()
    let persistedChanged = false
    for (const event of persistedEvents) {
      if (event.threadId === threadId && event.assistantId === assistantId) {
        if (!event.provider) {
          event.provider = input.provider
          persistedChanged = true
        }
        if (!event.modelId) {
          event.modelId = input.modelId
          persistedChanged = true
        }
        if (!event.requestId && input.requestId) {
          event.requestId = input.requestId
          persistedChanged = true
        }
      }
    }

    if (persistedChanged) {
      await this.writeAllEvents(persistedEvents)
    } else if (changed) {
      this.scheduleFlush()
    }
  }

  async analyzeLatestCommit(repoRoot: string, source: 'commit' | 'reconcile' = 'commit'): Promise<AiCommitReport | null> {
    const commitSha = await this.gitStdout(['rev-parse', 'HEAD'], repoRoot)
    if (!commitSha) {
      return null
    }
    return this.analyzeCommit(repoRoot, commitSha.trim(), source)
  }

  async reconcileRepo(repoRoot: string): Promise<void> {
    const pendingEntries = await this.readPendingCommits(repoRoot)
    const branchCommits = await this.listBranchCommits(repoRoot, 40)

    const orderedShas: string[] = []
    for (const entry of pendingEntries) {
      if (!orderedShas.includes(entry.commitSha)) {
        orderedShas.push(entry.commitSha)
      }
    }
    for (const commitSha of branchCommits) {
      if (!orderedShas.includes(commitSha)) {
        orderedShas.push(commitSha)
      }
    }

    const remainingPending: Array<{ timestamp: number; commitSha: string }> = []
    for (const commitSha of orderedShas) {
      const hasReport = await this.readCommitReport(repoRoot, commitSha)
      if (hasReport) {
        continue
      }
      const report = await this.analyzeCommit(repoRoot, commitSha, 'reconcile')
      if (!report && pendingEntries.some(entry => entry.commitSha === commitSha)) {
        remainingPending.push({
          timestamp: Date.now(),
          commitSha,
        })
      }
    }

    await this.writePendingCommits(repoRoot, remainingPending)
    this.dashboardCache.clear()
  }

  async reconcileWorkspaceRepos(): Promise<void> {
    const roots = useStore.getState().workspace?.roots || []
    for (const root of roots) {
      const repoRoot = await this.resolveRepoRoot(root)
      if (!repoRoot) continue
      await this.installHooks(repoRoot).catch(error => {
        logger.system.warn('[AiAttribution] Failed to install hooks:', { repoRoot, error })
      })
      await this.reconcileRepo(repoRoot).catch(error => {
        logger.system.warn('[AiAttribution] Failed to reconcile repo:', { repoRoot, error })
      })
    }
  }

  async getDashboardData(workspaceRoots: string[]): Promise<AiDashboardData> {
    const primaryRoot = workspaceRoots[0]
    if (!primaryRoot) {
      return EMPTY_AI_DASHBOARD_DATA
    }

    const repoRoot = await this.resolveRepoRoot(primaryRoot)
    if (!repoRoot) {
      return EMPTY_AI_DASHBOARD_DATA
    }

    const headSha = await this.gitStdout(['rev-parse', 'HEAD'], repoRoot)
    const cacheKey = `${repoRoot}::${headSha?.trim() || 'no-head'}`
    const cached = this.dashboardCache.get(cacheKey)
    if (cached) {
      return cached
    }

    await this.installHooks(repoRoot).catch(error => {
      logger.system.warn('[AiAttribution] Failed to ensure hooks before dashboard load:', error)
    })
    await this.reconcileRepo(repoRoot).catch(error => {
      logger.system.warn('[AiAttribution] Failed to reconcile repo before dashboard load:', error)
    })

    const branch = await this.getCurrentBranch(repoRoot)
    const baseRef = branch ? await this.resolveBaseRef(repoRoot, branch) : null
    const commitShas = branch ? await this.listRangeCommits(repoRoot, baseRef, 'HEAD', 120) : []
    const reports: AiCommitReport[] = []
    const pendingCommits: string[] = []
    for (const commitSha of commitShas) {
      const report = await this.readCommitReport(repoRoot, commitSha)
      if (report) {
        reports.push(report)
      } else {
        pendingCommits.push(commitSha)
      }
    }

    const hook = await this.getHookStatus(repoRoot)
    const hookPendingCommits = (await this.readPendingCommits(repoRoot)).map(entry => entry.commitSha)
    const uniquePendingCommits = [...new Set([...hookPendingCommits, ...pendingCommits])]
    const totals = {
      totalAddedLines: 0,
      pureAiLines: 0,
      aiModifiedLines: 0,
      humanLines: 0,
      aiAssistedShare: 0,
      pureAiShare: 0,
    }
    const fileMap = new Map<string, AiBranchFileSummary>()
    const modelMap = new Map<string, AiBranchModelSummary>()

    for (const report of reports) {
      totals.totalAddedLines += report.totals.totalAddedLines
      totals.pureAiLines += report.totals.pureAiLines
      totals.aiModifiedLines += report.totals.aiModifiedLines
      totals.humanLines += report.totals.humanLines

      for (const file of report.fileBreakdown) {
        const current = fileMap.get(file.path) || {
          path: file.path,
          totalAddedLines: 0,
          pureAiLines: 0,
          aiModifiedLines: 0,
          humanLines: 0,
        }
        current.totalAddedLines += file.totalAddedLines
        current.pureAiLines += file.pureAiLines
        current.aiModifiedLines += file.aiModifiedLines
        current.humanLines += file.humanLines
        fileMap.set(file.path, current)
      }

      for (const model of report.modelBreakdown) {
        const key = `${model.provider}::${model.modelId}`
        const current = modelMap.get(key) || {
          provider: model.provider,
          modelId: model.modelId,
          pureAiLines: 0,
          aiModifiedLines: 0,
        }
        current.pureAiLines += model.pureAiLines
        current.aiModifiedLines += model.aiModifiedLines
        modelMap.set(key, current)
      }
    }

    totals.aiAssistedShare = totals.totalAddedLines > 0
      ? (totals.pureAiLines + totals.aiModifiedLines) / totals.totalAddedLines
      : 0
    totals.pureAiShare = totals.totalAddedLines > 0
      ? totals.pureAiLines / totals.totalAddedLines
      : 0

    const data: AiDashboardData = {
      available: true,
      repoName: getFileName(repoRoot) || 'Repository',
      repoRoot,
      branch,
      baseRef,
      hook: {
        installed: hook.installed,
        pendingCount: uniquePendingCommits.length,
      },
      overview: totals,
      recentCommits: reports
        .slice()
        .sort((left, right) => right.timestamp - left.timestamp)
        .slice(0, MAX_RECENT_COMMITS),
      modelBreakdown: [...modelMap.values()]
        .sort((left, right) => (right.pureAiLines + right.aiModifiedLines) - (left.pureAiLines + left.aiModifiedLines))
        .slice(0, MAX_MODEL_BREAKDOWN),
      topFiles: [...fileMap.values()]
        .sort((left, right) => (right.pureAiLines + right.aiModifiedLines) - (left.pureAiLines + left.aiModifiedLines))
        .slice(0, MAX_TOP_FILES),
      pendingCommits: uniquePendingCommits,
      lastCommit: reports.length > 0
        ? reports.slice().sort((left, right) => right.timestamp - left.timestamp)[0]
        : null,
    }

    this.dashboardCache.clear()
    this.dashboardCache.set(cacheKey, data)
    return data
  }

  async installHooks(repoRoot: string): Promise<boolean> {
    const gitDir = await this.gitStdout(['rev-parse', '--git-dir'], repoRoot)
    if (!gitDir) {
      return false
    }

    const resolvedGitDir = gitDir.trim().startsWith('/')
      ? gitDir.trim()
      : joinPath(repoRoot, gitDir.trim())
    const hooksDir = joinPath(resolvedGitDir, 'hooks')
    const hookPath = joinPath(hooksDir, 'post-commit')
    const existing = await api.file.read(hookPath) || ''
    if (existing.includes(HOOK_MARKER_START) && existing.includes(HOOK_MARKER_END)) {
      return true
    }

    const hookBlock = [
      HOOK_MARKER_START,
      'if command -v git >/dev/null 2>&1; then',
      '  repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0',
      '  git_dir="$(git rev-parse --git-dir 2>/dev/null)" || exit 0',
      '  head_sha="$(git rev-parse HEAD 2>/dev/null)" || exit 0',
      `  mkdir -p "$git_dir/${HOOK_PENDING_DIR}" 2>/dev/null || exit 0`,
      `  printf '%s\\t%s\\n' "$(date +%s)" "$head_sha" >> "$git_dir/${HOOK_PENDING_FILE}"`,
      'fi',
      HOOK_MARKER_END,
      '',
    ].join('\n')

    const base = existing.trim().length > 0
      ? existing.replace(/\s*$/, '\n\n')
      : '#!/bin/sh\n\n'

    await api.file.ensureDir(hooksDir)
    return api.file.write(hookPath, `${base}${hookBlock}`)
  }

  async getHookStatus(repoRoot: string): Promise<AiHookStatus> {
    const gitDir = await this.gitStdout(['rev-parse', '--git-dir'], repoRoot)
    if (!gitDir) {
      return { installed: false, pendingCount: 0 }
    }

    const resolvedGitDir = gitDir.trim().startsWith('/')
      ? gitDir.trim()
      : joinPath(repoRoot, gitDir.trim())
    const hookPath = joinPath(resolvedGitDir, 'hooks', 'post-commit')
    const hookContent = await api.file.read(hookPath)
    const pending = await this.readPendingCommits(repoRoot)
    return {
      installed: Boolean(hookContent?.includes(HOOK_MARKER_START)),
      pendingCount: pending.length,
    }
  }

  async readAiNote(repoRoot: string, commitSha: string): Promise<AiCommitReport | null> {
    const content = await this.gitStdout(['notes', '--ref', NOTES_REF, 'show', commitSha], repoRoot)
    return content ? safeParseJson<AiCommitReport>(content) : null
  }

  async writeAiNote(repoRoot: string, commitSha: string, report: AiCommitReport): Promise<boolean> {
    const result = await api.git.execSecure(['notes', '--ref', NOTES_REF, 'add', '-f', '-m', JSON.stringify(report), commitSha], repoRoot)
    return result.success !== false && result.exitCode === 0
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush()
    }, 3000)
  }

  private async ensureStoragePaths(): Promise<void> {
    if (!this.workspaceRoot || !adnifyDir.isInitialized()) {
      return
    }
    await api.file.ensureDir(adnifyDir.getFilePath(AI_STATS_DIR))
    await api.file.ensureDir(adnifyDir.getFilePath(COMMIT_REPORTS_DIR))
  }

  private async resolveRepoContext(workspacePath: string | null, filePath: string): Promise<RepoContext | null> {
    const workspaceRoot = workspacePath || this.workspaceRoot || useStore.getState().workspace?.roots?.[0] || null
    if (!workspaceRoot) {
      return null
    }

    const repoRoot = await this.resolveRepoRoot(pathStartsWith(filePath, workspaceRoot) ? getDirname(filePath) || workspaceRoot : workspaceRoot)
    if (!repoRoot) {
      return null
    }

    const branch = await this.getCurrentBranch(repoRoot)
    return {
      repoRoot,
      branch,
      workspaceRoot,
      repoKey: buildRepoKey(repoRoot),
    }
  }

  private lookupAssistantResponseMeta(threadId?: string, assistantId?: string): {
    provider: string
    modelId: string
    requestId?: string
  } | null {
    if (!threadId || !assistantId) {
      return null
    }

    const thread = useAgentStore.getState().threads[threadId]
    const message = thread?.messages.find(item => item.role === 'assistant' && item.id === assistantId)
    if (!message || message.role !== 'assistant' || !message.responseMeta) {
      return null
    }

    return {
      provider: message.responseMeta.provider,
      modelId: message.responseMeta.modelId,
      requestId: message.responseMeta.requestId,
    }
  }

  private async resolveRepoRoot(cwd: string): Promise<string | null> {
    const stdout = await this.gitStdout(['rev-parse', '--show-toplevel'], cwd)
    return stdout ? normalizePath(stdout.trim()) : null
  }

  private async getCurrentBranch(repoRoot: string): Promise<string> {
    const branch = await this.gitStdout(['branch', '--show-current'], repoRoot)
    if (branch?.trim()) {
      return branch.trim()
    }
    const fallback = await this.gitStdout(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot)
    return coerceBranchName(fallback?.trim())
  }

  private async gitStdout(args: string[], cwd: string): Promise<string | null> {
    try {
      const result = await api.git.execSecure(args, cwd)
      if (result.success === false || result.exitCode !== 0) {
        return null
      }
      return result.stdout || ''
    } catch {
      return null
    }
  }

  private async readWriteEvents(): Promise<AiWriteEvent[]> {
    await this.flush()
    if (this.eventsCache) {
      return this.eventsCache.map(event => ({ ...event }))
    }

    const content = await adnifyDir.readText(WRITE_EVENTS_FILE)
    if (!content) {
      this.eventsCache = []
      return []
    }

    this.eventsCache = content
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => safeParseJson<AiWriteEvent>(line))
      .filter((event): event is AiWriteEvent => event !== null)

    return this.eventsCache.map(event => ({ ...event }))
  }

  private async writeAllEvents(events: AiWriteEvent[]): Promise<void> {
    await this.ensureStoragePaths()
    await adnifyDir.writeText(WRITE_EVENTS_FILE, formatJsonl(events))
    this.eventsCache = events.map(event => ({ ...event }))
    this.dashboardCache.clear()
  }

  private async analyzeCommit(repoRoot: string, commitSha: string, source: 'commit' | 'reconcile'): Promise<AiCommitReport | null> {
    const workspaceRoot = this.workspaceRoot || useStore.getState().workspace?.roots?.[0]
    if (!workspaceRoot || !adnifyDir.isInitialized()) {
      return null
    }

    const existing = await this.readCommitReport(repoRoot, commitSha)
    if (existing) {
      return existing
    }

    const commitInfo = await this.readCommitInfo(repoRoot, commitSha)
    if (!commitInfo) {
      return null
    }

    const patch = await this.gitStdout(['show', '--format=', '--unified=3', '--no-ext-diff', '--find-renames=0', commitSha], repoRoot)
    if (!patch) {
      return null
    }

    const addedLines = parseAddedCommitLinesFromPatch(patch)
    const events = (await this.readWriteEvents())
      .filter(event => event.repoRoot === repoRoot)
      .filter(event => event.timestamp <= commitInfo.timestamp)
      .filter(event => event.branch === commitInfo.branch)

    const classifiedLines = classifyCommitAddedLines(addedLines, events, AI_EDIT_SIMILARITY_THRESHOLD)
    const fileMap = new Map<string, AiCommitFileSummary>()
    const modelMap = new Map<string, AiCommitModelSummary>()
    const eventMap = new Map<string, AiCommitEventRef>()

    for (const result of classifiedLines) {
      const current = fileMap.get(result.path) || {
        path: result.path,
        totalAddedLines: 0,
        pureAiLines: 0,
        aiModifiedLines: 0,
        humanLines: 0,
      }
      current.totalAddedLines += 1
      if (result.kind === 'pure_ai') {
        current.pureAiLines += 1
      } else if (result.kind === 'ai_modified') {
        current.aiModifiedLines += 1
      } else {
        current.humanLines += 1
      }
      fileMap.set(result.path, current)

      if ((result.kind === 'pure_ai' || result.kind === 'ai_modified') && result.provider && result.modelId) {
        const modelKey = `${result.provider}::${result.modelId}`
        const model = modelMap.get(modelKey) || {
          provider: result.provider,
          modelId: result.modelId,
          pureAiLines: 0,
          aiModifiedLines: 0,
        }
        if (result.kind === 'pure_ai') {
          model.pureAiLines += 1
        } else {
          model.aiModifiedLines += 1
        }
        modelMap.set(modelKey, model)
      }

      if ((result.kind === 'pure_ai' || result.kind === 'ai_modified') && result.eventId) {
        const eventRef = eventMap.get(result.eventId) || {
          eventId: result.eventId,
          pureAiLines: 0,
          aiModifiedLines: 0,
        }
        if (result.kind === 'pure_ai') {
          eventRef.pureAiLines += 1
        } else {
          eventRef.aiModifiedLines += 1
        }
        eventMap.set(result.eventId, eventRef)
      }
    }

    const totalAddedLines = classifiedLines.length
    const pureAiLines = classifiedLines.filter(line => line.kind === 'pure_ai').length
    const aiModifiedLines = classifiedLines.filter(line => line.kind === 'ai_modified').length
    const humanLines = classifiedLines.filter(line => line.kind === 'human').length

    const report: AiCommitReport = {
      version: 1,
      commitSha,
      shortSha: commitSha.slice(0, 8),
      parentSha: commitInfo.parentSha,
      branch: commitInfo.branch,
      repoRoot,
      repoKey: buildRepoKey(repoRoot),
      message: commitInfo.message,
      author: commitInfo.author,
      timestamp: commitInfo.timestamp,
      source,
      totals: {
        totalAddedLines,
        pureAiLines,
        aiModifiedLines,
        humanLines,
        aiAssistedShare: totalAddedLines > 0 ? (pureAiLines + aiModifiedLines) / totalAddedLines : 0,
        pureAiShare: totalAddedLines > 0 ? pureAiLines / totalAddedLines : 0,
      },
      fileBreakdown: [...fileMap.values()].sort((left, right) => right.totalAddedLines - left.totalAddedLines),
      modelBreakdown: [...modelMap.values()].sort((left, right) => (right.pureAiLines + right.aiModifiedLines) - (left.pureAiLines + left.aiModifiedLines)),
      eventRefs: [...eventMap.values()],
    }

    await this.writeCommitReport(report)
    await this.writeAiNote(repoRoot, commitSha, report)
    this.dashboardCache.clear()
    return report
  }

  private async readCommitInfo(repoRoot: string, commitSha: string): Promise<{
    parentSha: string | null
    message: string
    author: string
    timestamp: number
    branch: string
  } | null> {
    const line = await this.gitStdout(['show', '-s', '--format=%P%x00%s%x00%an%x00%aI', commitSha], repoRoot)
    if (!line) {
      return null
    }
    const [parents, message, author, isoDate] = line.split('\0')
    return {
      parentSha: parents?.split(' ').filter(Boolean)[0] || null,
      message: message || '',
      author: author || '',
      timestamp: isoDate ? new Date(isoDate.trim()).getTime() : Date.now(),
      branch: await this.getCurrentBranch(repoRoot),
    }
  }

  private getCommitReportPath(repoRoot: string, commitSha: string): string {
    return `${COMMIT_REPORTS_DIR}/${buildRepoKey(repoRoot)}/${commitSha}.json`
  }

  private async readCommitReport(repoRoot: string, commitSha: string): Promise<AiCommitReport | null> {
    const cacheKey = `${normalizePath(repoRoot)}::${commitSha}`
    if (this.commitReportCache.has(cacheKey)) {
      return this.commitReportCache.get(cacheKey) ?? null
    }

    const pending = this.pendingCommitReportReads.get(cacheKey)
    if (pending) return pending

    const read = (async () => {
      const local = await adnifyDir.readText(this.getCommitReportPath(repoRoot, commitSha))
      if (local) {
        const parsed = safeParseJson<AiCommitReport>(local)
        if (parsed) {
          return parsed
        }
      }
      return this.readAiNote(repoRoot, commitSha)
    })()

    this.pendingCommitReportReads.set(cacheKey, read)
    try {
      const report = await read
      this.commitReportCache.set(cacheKey, report)
      return report
    } finally {
      if (this.pendingCommitReportReads.get(cacheKey) === read) {
        this.pendingCommitReportReads.delete(cacheKey)
      }
    }
  }

  private async writeCommitReport(report: AiCommitReport): Promise<void> {
    await this.ensureStoragePaths()
    await api.file.ensureDir(adnifyDir.getFilePath(`${COMMIT_REPORTS_DIR}/${report.repoKey}`))
    const written = await adnifyDir.writeText(
      this.getCommitReportPath(report.repoRoot, report.commitSha),
      JSON.stringify(report, null, 2)
    )
    if (written) {
      this.commitReportCache.set(`${normalizePath(report.repoRoot)}::${report.commitSha}`, report)
    }
  }

  private async readPendingCommits(repoRoot: string): Promise<Array<{ timestamp: number; commitSha: string }>> {
    const gitDir = await this.gitStdout(['rev-parse', '--git-dir'], repoRoot)
    if (!gitDir) {
      return []
    }
    const resolvedGitDir = gitDir.trim().startsWith('/')
      ? gitDir.trim()
      : joinPath(repoRoot, gitDir.trim())
    const pendingPath = joinPath(resolvedGitDir, HOOK_PENDING_FILE)
    const content = await api.file.read(pendingPath)
    if (!content) {
      return []
    }
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const [timestamp, commitSha] = line.split('\t')
        const parsedTimestamp = Number(timestamp)
        if (!commitSha) {
          return null
        }
        return {
          timestamp: Number.isFinite(parsedTimestamp) ? parsedTimestamp * 1000 : Date.now(),
          commitSha,
        }
      })
      .filter((entry): entry is { timestamp: number; commitSha: string } => entry !== null)
  }

  private async writePendingCommits(repoRoot: string, entries: Array<{ timestamp: number; commitSha: string }>): Promise<void> {
    const gitDir = await this.gitStdout(['rev-parse', '--git-dir'], repoRoot)
    if (!gitDir) {
      return
    }
    const resolvedGitDir = gitDir.trim().startsWith('/')
      ? gitDir.trim()
      : joinPath(repoRoot, gitDir.trim())
    const dirPath = joinPath(resolvedGitDir, HOOK_PENDING_DIR)
    const filePath = joinPath(resolvedGitDir, HOOK_PENDING_FILE)
    await api.file.ensureDir(dirPath)
    if (entries.length === 0) {
      if (await api.file.exists(filePath)) {
        await api.file.delete(filePath)
      }
      return
    }
    const content = entries
      .map(entry => `${Math.floor(entry.timestamp / 1000)}\t${entry.commitSha}`)
      .join('\n')
    await api.file.write(filePath, `${content}\n`)
  }

  private async listBranchCommits(repoRoot: string, count: number): Promise<string[]> {
    const stdout = await this.gitStdout(['log', `-${count}`, '--pretty=format:%H'], repoRoot)
    if (!stdout) {
      return []
    }
    return stdout
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
  }

  private async listRangeCommits(repoRoot: string, baseRef: string | null, headRef: string, count: number): Promise<string[]> {
    const range = baseRef ? `${baseRef}..${headRef}` : headRef
    const stdout = await this.gitStdout(['log', range, `-${count}`, '--pretty=format:%H'], repoRoot)
    if (!stdout) {
      return []
    }
    return stdout
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
  }

  private async resolveBaseRef(repoRoot: string, _branch: string): Promise<string | null> {
    const upstream = await this.gitStdout(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], repoRoot)
    if (upstream?.trim()) {
      const mergeBase = await this.gitStdout(['merge-base', 'HEAD', upstream.trim()], repoRoot)
      if (mergeBase?.trim()) {
        return mergeBase.trim()
      }
    }

    const remoteHead = await this.gitStdout(['symbolic-ref', 'refs/remotes/origin/HEAD'], repoRoot)
    if (remoteHead?.trim()) {
      const mergeBase = await this.gitStdout(['merge-base', 'HEAD', remoteHead.trim()], repoRoot)
      if (mergeBase?.trim()) {
        return mergeBase.trim()
      }
    }

    for (const fallback of ['origin/main', 'origin/master', 'main', 'master']) {
      const mergeBase = await this.gitStdout(['merge-base', 'HEAD', fallback], repoRoot)
      if (mergeBase?.trim()) {
        return mergeBase.trim()
      }
    }

    const rootCommit = await this.gitStdout(['rev-list', '--max-parents=0', 'HEAD'], repoRoot)
    return rootCommit?.split('\n').map(line => line.trim()).find(Boolean) || null
  }
}

export const aiAttributionService = new AiAttributionService()
