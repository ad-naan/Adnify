import { api } from '@/renderer/services/electronAPI'
import { agentSessionRepository } from './agentSessionRepository'
import { ADNIFY_DIR_NAME, adnifyDir } from './adnifyDirService'
import { gitService } from './gitService'
import { ignoreService } from './ignoreService'
import { logger } from '@utils/Logger'
import { useStore, type WorkspaceConfig } from '@store'
import { isAssistantMessage, isUserMessage, type AssistantMessage, type ChatMessage } from '@renderer/agent/types'
import { isFileEditTool } from '@shared/config/tools'

type DashboardRange = 'daily' | 'weekly' | 'monthly'

type AnalyticsEvent =
  | {
    type: 'file_change'
    timestamp: number
    path: string
    event: 'create' | 'update' | 'delete'
  }
  | {
    type: 'active_segment'
    startAt: number
    endAt: number
  }

interface DashboardStatMetric {
  value: string
  rawValue: number
  trend: string
}

interface DashboardModelRow {
  name: string
  requests: number
  tokens: number
  avgResponseMs: number
}

interface DashboardWorkspaceStats {
  activityPercent: number
  activeProjects: number
  pendingTasks: number
  updatesToday: number
}

export interface WorkspaceDashboardData {
  overview: {
    fileChanges: DashboardStatMetric
    commits: DashboardStatMetric
    sessions: DashboardStatMetric
    activeHours: DashboardStatMetric
  }
  chartPoints: number[]
  workspace: DashboardWorkspaceStats
  models: DashboardModelRow[]
}

const EMPTY_WORKSPACE_DASHBOARD_DATA: WorkspaceDashboardData = {
  overview: {
    fileChanges: { value: '0', rawValue: 0, trend: '+0.0%' },
    commits: { value: '0', rawValue: 0, trend: '+0.0%' },
    sessions: { value: '0', rawValue: 0, trend: '+0.0%' },
    activeHours: { value: '0.0', rawValue: 0, trend: '+0.0%' },
  },
  chartPoints: [0, 0, 0, 0, 0, 0],
  workspace: {
    activityPercent: 0,
    activeProjects: 0,
    pendingTasks: 0,
    updatesToday: 0,
  },
  models: [],
}

const STATS_FILE = 'stats/events.jsonl'
const ACTIVITY_IDLE_MS = 60_000
const ACTIVITY_MIN_SEGMENT_MS = 15_000
const ACTIVITY_TICK_MS = 15_000
const REFRESH_COMMITS_PER_REPO = 240

class WorkspaceAnalyticsService {
  private dashboardCache = new Map<string, {
    timestamp: number
    data: WorkspaceDashboardData
    promise?: Promise<WorkspaceDashboardData>
  }>()
  private workspaceRoot: string | null = null
  private currentWorkspaceKey: string | null = null
  private eventQueue: AnalyticsEvent[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private flushPromise: Promise<void> | null = null
  private fileWatcherCleanup: (() => void) | null = null
  private activityInterval: ReturnType<typeof setInterval> | null = null
  private activityListenersBound = false
  private activeSegmentStartAt: number | null = null
  private lastActivityAt: number | null = null
  private lastMoveAt = 0
  private eventsCache: AnalyticsEvent[] | null = null

  async bindWorkspace(workspace: WorkspaceConfig | null): Promise<void> {
    const nextRoot = workspace?.roots?.[0] || null
    const nextKey = workspace ? workspace.roots.join('|') : null

    if (!nextRoot || !nextKey) {
      await this.flush()
      this.teardownCollectors()
      this.workspaceRoot = null
      this.currentWorkspaceKey = null
      this.eventsCache = null
      return
    }

    if (this.workspaceRoot === nextRoot && this.currentWorkspaceKey === nextKey) {
      return
    }

    await this.flush()
    this.teardownCollectors()

    this.workspaceRoot = nextRoot
    this.currentWorkspaceKey = nextKey
    this.eventsCache = null
    await ignoreService.loadIgnoreFile(nextRoot).catch(error => {
      logger.system.warn('[WorkspaceAnalytics] Failed to load ignore rules:', error)
    })

    this.fileWatcherCleanup = api.file.onChanged((event) => {
      if (this.isIgnoredWorkspacePath(event.path)) {
        return
      }

      this.enqueueEvent({
        type: 'file_change',
        timestamp: Date.now(),
        path: event.path,
        event: event.event,
      })
    })

    this.startActivityTracking()
  }

  reset(): void {
    this.teardownCollectors()
    this.workspaceRoot = null
    this.currentWorkspaceKey = null
    this.eventQueue = []
    this.eventsCache = null
  }

  async flush(): Promise<void> {
    this.closeActiveSegment()

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
        const existing = await adnifyDir.readText(STATS_FILE)
        const nextLines = pending.map(event => JSON.stringify(event)).join('\n')
        const nextContent = existing && existing.trim().length > 0
          ? `${existing.trimEnd()}\n${nextLines}\n`
          : `${nextLines}\n`
        await adnifyDir.writeText(STATS_FILE, nextContent)
        this.eventsCache = this.eventsCache ? [...this.eventsCache, ...pending] : null
      } catch (error) {
        logger.system.warn('[WorkspaceAnalytics] Failed to flush analytics events:', error)
        this.eventQueue.unshift(...pending)
      } finally {
        this.flushPromise = null
      }
    })()

    await this.flushPromise
  }

  async getDashboardData(
    range: DashboardRange,
    selectedDate: string,
  ): Promise<WorkspaceDashboardData> {
    const workspace = useStore.getState().workspace
    const workspaceRoots = workspace?.roots || []
    const workspaceKey = workspaceRoots.join('|')
    const cacheKey = `${workspaceKey}::${range}::${selectedDate}`
    const now = Date.now()
    const cached = this.dashboardCache.get(cacheKey)

    if (cached?.data && now - cached.timestamp < 15_000) {
      return cached.data
    }

    if (cached?.promise) {
      return cached.promise
    }

    const loadPromise = this.computeDashboardData(range, selectedDate, workspaceRoots)
      .then(data => {
        this.dashboardCache.set(cacheKey, {
          timestamp: Date.now(),
          data,
        })
        return data
      })
      .finally(() => {
        const latest = this.dashboardCache.get(cacheKey)
        if (latest?.promise) {
          this.dashboardCache.set(cacheKey, {
            timestamp: latest.timestamp,
            data: latest.data,
          })
        }
      })

    this.dashboardCache.set(cacheKey, {
      timestamp: cached?.timestamp || 0,
      data: cached?.data || EMPTY_WORKSPACE_DASHBOARD_DATA,
      promise: loadPromise,
    })

    return loadPromise
  }

  private async computeDashboardData(
    range: DashboardRange,
    selectedDate: string,
    workspaceRoots: string[],
  ): Promise<WorkspaceDashboardData> {
    const period = this.getPeriod(range, selectedDate)
    const previousPeriod = this.getPreviousPeriod(period)

    const [events, sessionSnapshot, repositories] = await Promise.all([
      this.readEvents(),
      agentSessionRepository.getSnapshot(),
      this.discoverWorkspaceRepositories(workspaceRoots),
    ])

    const threads = sessionSnapshot?.threads || {}
    const todos = Object.values(threads).flatMap(thread => thread.todos || [])
    const threadIds = Object.keys(threads)
    const threadMessages = await Promise.all(threadIds.map(async threadId => ({
      threadId,
      messages: await agentSessionRepository.loadThreadMessages(threadId),
    })))
    const allMessages = threadMessages.flatMap(item => item.messages)

    const fileChangeEvents = events.filter((event): event is Extract<AnalyticsEvent, { type: 'file_change' }> => (
      event.type === 'file_change' && !this.isIgnoredWorkspacePath(event.path)
    ))
    const activeSegments = events.filter((event): event is Extract<AnalyticsEvent, { type: 'active_segment' }> => event.type === 'active_segment')

    const currentFileChanges = this.countFileChanges(period, fileChangeEvents, allMessages)
    const previousFileChanges = this.countFileChanges(previousPeriod, fileChangeEvents, allMessages)
    const currentSessions = this.countSessions(period, allMessages)
    const previousSessions = this.countSessions(previousPeriod, allMessages)
    const currentActiveMs = this.countActiveMs(period, activeSegments, allMessages, fileChangeEvents)
    const previousActiveMs = this.countActiveMs(previousPeriod, activeSegments, allMessages, fileChangeEvents)

    const commitsResult = await this.countCommitsByPeriod(repositories, period, previousPeriod)

    return {
      overview: {
        fileChanges: this.toMetric(currentFileChanges, previousFileChanges, 'count'),
        commits: this.toMetric(commitsResult.currentCount, commitsResult.previousCount, 'count'),
        sessions: this.toMetric(currentSessions, previousSessions, 'count'),
        activeHours: this.toMetric(currentActiveMs / 3_600_000, previousActiveMs / 3_600_000, 'hours'),
      },
      chartPoints: this.buildChartPoints(period, fileChangeEvents, allMessages),
      workspace: {
        activityPercent: this.computeActivityPercent(range, currentActiveMs),
        activeProjects: this.countActiveProjects(period, repositories, fileChangeEvents, commitsResult.currentHashes),
        pendingTasks: todos.filter(todo => todo.status !== 'completed').length,
        updatesToday: this.countProjectsUpdatedToday(repositories, fileChangeEvents),
      },
      models: this.buildModelRows(period, allMessages),
    }
  }

  private teardownCollectors(): void {
    this.closeActiveSegment()

    this.fileWatcherCleanup?.()
    this.fileWatcherCleanup = null

    if (this.activityInterval) {
      clearInterval(this.activityInterval)
      this.activityInterval = null
    }

    if (this.activityListenersBound) {
      window.removeEventListener('pointerdown', this.handleActivity)
      window.removeEventListener('keydown', this.handleActivity)
      window.removeEventListener('mousemove', this.handleMouseMove)
      window.removeEventListener('focus', this.handleActivity)
      document.removeEventListener('visibilitychange', this.handleVisibilityChange)
      this.activityListenersBound = false
    }
  }

  private startActivityTracking(): void {
    if (typeof window === 'undefined') {
      return
    }

    if (!this.activityListenersBound) {
      window.addEventListener('pointerdown', this.handleActivity, { passive: true })
      window.addEventListener('keydown', this.handleActivity, { passive: true })
      window.addEventListener('mousemove', this.handleMouseMove, { passive: true })
      window.addEventListener('focus', this.handleActivity, { passive: true })
      document.addEventListener('visibilitychange', this.handleVisibilityChange)
      this.activityListenersBound = true
    }

    this.handleActivity()

    this.activityInterval = setInterval(() => {
      if (document.hidden) {
        this.closeActiveSegment()
        return
      }

      if (!this.lastActivityAt) {
        return
      }

      if (Date.now() - this.lastActivityAt > ACTIVITY_IDLE_MS) {
        this.closeActiveSegment()
      }
    }, ACTIVITY_TICK_MS)
  }

  private readonly handleActivity = (): void => {
    const now = Date.now()
    this.lastActivityAt = now
    if (this.activeSegmentStartAt === null) {
      this.activeSegmentStartAt = now
    }
  }

  private readonly handleMouseMove = (): void => {
    const now = Date.now()
    if (now - this.lastMoveAt < 10_000) {
      return
    }
    this.lastMoveAt = now
    this.handleActivity()
  }

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.closeActiveSegment()
      return
    }
    this.handleActivity()
  }

  private closeActiveSegment(): void {
    if (!this.activeSegmentStartAt || !this.lastActivityAt) {
      this.activeSegmentStartAt = null
      return
    }

    const endAt = Math.max(this.lastActivityAt, this.activeSegmentStartAt)
    if (endAt - this.activeSegmentStartAt >= ACTIVITY_MIN_SEGMENT_MS) {
      this.enqueueEvent({
        type: 'active_segment',
        startAt: this.activeSegmentStartAt,
        endAt,
      })
    }

    this.activeSegmentStartAt = null
  }

  private enqueueEvent(event: AnalyticsEvent): void {
    this.eventQueue.push(event)
    if (this.flushTimer) {
      return
    }

    this.flushTimer = setTimeout(() => {
      this.flush().catch(error => {
        logger.system.warn('[WorkspaceAnalytics] Flush timer failed:', error)
      })
    }, 4_000)
  }

  private async readEvents(): Promise<AnalyticsEvent[]> {
    if (this.eventsCache) {
      return this.eventsCache
    }

    const content = await adnifyDir.readText(STATS_FILE)
    if (!content) {
      this.eventsCache = []
      return this.eventsCache
    }

    this.eventsCache = content
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line) as AnalyticsEvent
        } catch {
          return null
        }
      })
      .filter((event): event is AnalyticsEvent => event !== null)

    return this.eventsCache
  }

  private isIgnoredWorkspacePath(filePath: string): boolean {
    if (ignoreService.isIgnored(filePath)) {
      return true
    }

    const normalizedPath = filePath.replace(/\\/g, '/')
    const segments = normalizedPath.split('/').filter(Boolean)
    return segments.includes(ADNIFY_DIR_NAME)
  }

  private async discoverWorkspaceRepositories(workspaceRoots: string[]): Promise<string[]> {
    const repositories = new Set<string>()

    for (const root of workspaceRoots) {
      const discovered = await gitService.discoverRepositories(root, 2).catch(() => [])
      if (discovered.length === 0) {
        repositories.add(root)
        continue
      }

      for (const repo of discovered) {
        repositories.add(repo.root)
      }
    }

    return [...repositories]
  }

  private async countCommitsByPeriod(
    repositories: string[],
    current: { startAt: number; endAt: number },
    previous: { startAt: number; endAt: number },
  ): Promise<{ currentCount: number; previousCount: number; currentHashes: Array<{ repo: string; hash: string; timestamp: number }> }> {
    let currentCount = 0
    let previousCount = 0
    const currentHashes: Array<{ repo: string; hash: string; timestamp: number }> = []

    await Promise.all(repositories.map(async repo => {
      const commits = await gitService.getRecentCommits(REFRESH_COMMITS_PER_REPO, repo).catch(() => [])
      for (const commit of commits) {
        const timestamp = commit.date.getTime()
        if (timestamp >= current.startAt && timestamp < current.endAt) {
          currentCount += 1
          currentHashes.push({ repo, hash: commit.hash, timestamp })
        } else if (timestamp >= previous.startAt && timestamp < previous.endAt) {
          previousCount += 1
        }
      }
    }))

    return { currentCount, previousCount, currentHashes }
  }

  private countFileChanges(
    period: { startAt: number; endAt: number },
    fileChangeEvents: Array<Extract<AnalyticsEvent, { type: 'file_change' }>>,
    messages: ChatMessage[],
  ): number {
    const eventCount = fileChangeEvents.filter(event => event.timestamp >= period.startAt && event.timestamp < period.endAt).length
    if (eventCount > 0) {
      return eventCount
    }

    return messages.filter((message): message is AssistantMessage =>
      isAssistantMessage(message)
      && message.timestamp >= period.startAt
      && message.timestamp < period.endAt
    ).reduce((count, message) => {
      const fileEditCalls = message.parts.filter(part =>
        part.type === 'tool_call' && isFileEditTool(part.toolCall.name)
      )
      return count + fileEditCalls.length
    }, 0)
  }

  private countSessions(period: { startAt: number; endAt: number }, messages: ChatMessage[]): number {
    return messages.filter(message =>
      isUserMessage(message)
      && message.timestamp >= period.startAt
      && message.timestamp < period.endAt
    ).length
  }

  private countActiveMs(
    period: { startAt: number; endAt: number },
    segments: Array<Extract<AnalyticsEvent, { type: 'active_segment' }>>,
    messages: ChatMessage[],
    fileChangeEvents: Array<Extract<AnalyticsEvent, { type: 'file_change' }>>,
  ): number {
    const recordedMs = segments.reduce((total, segment) => {
      const startAt = Math.max(segment.startAt, period.startAt)
      const endAt = Math.min(segment.endAt, period.endAt)
      return endAt > startAt ? total + (endAt - startAt) : total
    }, 0)

    if (recordedMs > 0) {
      return recordedMs
    }

    const signalTimes = [
      ...messages
        .filter(message => message.timestamp >= period.startAt && message.timestamp < period.endAt)
        .map(message => message.timestamp),
      ...fileChangeEvents
        .filter(event => event.timestamp >= period.startAt && event.timestamp < period.endAt)
        .map(event => event.timestamp),
    ].sort((left, right) => left - right)

    if (signalTimes.length === 0) {
      return 0
    }

    let total = 0
    let clusterStart = signalTimes[0]
    let prev = signalTimes[0]

    for (let index = 1; index < signalTimes.length; index += 1) {
      const current = signalTimes[index]
      if (current - prev > ACTIVITY_IDLE_MS) {
        total += Math.min(30 * 60_000, Math.max(ACTIVITY_MIN_SEGMENT_MS, prev - clusterStart + 5 * 60_000))
        clusterStart = current
      }
      prev = current
    }

    total += Math.min(30 * 60_000, Math.max(ACTIVITY_MIN_SEGMENT_MS, prev - clusterStart + 5 * 60_000))
    return total
  }

  private buildChartPoints(
    period: { startAt: number; endAt: number },
    fileChangeEvents: Array<Extract<AnalyticsEvent, { type: 'file_change' }>>,
    messages: ChatMessage[],
  ): number[] {
    const bucketCount = this.getChartBucketCount(period)
    const bucketSize = (period.endAt - period.startAt) / bucketCount
    const points = Array.from({ length: bucketCount }, () => 0)

    const relevantEvents = fileChangeEvents.filter(event => event.timestamp >= period.startAt && event.timestamp < period.endAt)

    if (relevantEvents.length > 0) {
      for (const event of relevantEvents) {
        const bucketIndex = Math.min(bucketCount - 1, Math.floor((event.timestamp - period.startAt) / bucketSize))
        points[bucketIndex] += 1
      }
      return points
    }

    const fallbackMessages = messages.filter(message =>
      message.timestamp >= period.startAt
      && message.timestamp < period.endAt
      && (isUserMessage(message) || isAssistantMessage(message))
    )

    for (const message of fallbackMessages) {
      const bucketIndex = Math.min(bucketCount - 1, Math.floor((message.timestamp - period.startAt) / bucketSize))
      points[bucketIndex] += 1
    }

    return points
  }

  private getChartBucketCount(period: { startAt: number; endAt: number }): number {
    const durationMs = period.endAt - period.startAt
    const oneDayMs = 24 * 60 * 60_000
    const oneWeekMs = 7 * oneDayMs

    if (durationMs <= oneDayMs) {
      return 6
    }

    if (durationMs <= oneWeekMs) {
      return 7
    }

    return 6
  }

  private buildModelRows(period: { startAt: number; endAt: number }, messages: ChatMessage[]): DashboardModelRow[] {
    const rows = new Map<string, DashboardModelRow>()
    let legacyUsageRequests = 0
    let legacyUsageTokens = 0

    for (const message of messages) {
      if (!isAssistantMessage(message) || !message.usage) {
        continue
      }
      if (message.timestamp < period.startAt || message.timestamp >= period.endAt) {
        continue
      }

      const responseMeta = (message as AssistantMessage).responseMeta
      if (!responseMeta?.modelId) {
        legacyUsageRequests += 1
        legacyUsageTokens += message.usage.totalTokens || 0
        continue
      }

      const key = responseMeta.modelId
      const row = rows.get(key) || {
        name: responseMeta.modelId,
        requests: 0,
        tokens: 0,
        avgResponseMs: 0,
      }

      row.requests += 1
      row.tokens += message.usage.totalTokens || 0
      row.avgResponseMs += responseMeta.durationMs || 0
      rows.set(key, row)
    }

    const modelRows = [...rows.values()]
      .map(row => ({
        ...row,
        avgResponseMs: row.requests > 0 ? row.avgResponseMs / row.requests : 0,
      }))
      .sort((left, right) => right.requests - left.requests)

    if (legacyUsageRequests > 0) {
      modelRows.push({
        name: 'Legacy Sessions',
        requests: legacyUsageRequests,
        tokens: legacyUsageTokens,
        avgResponseMs: 0,
      })
    }

    return modelRows.slice(0, 5)
  }

  private countActiveProjects(
    period: { startAt: number; endAt: number },
    repositories: string[],
    fileChangeEvents: Array<Extract<AnalyticsEvent, { type: 'file_change' }>>,
    currentCommitHashes: Array<{ repo: string; hash: string; timestamp: number }>,
  ): number {
    const activeRepos = new Set<string>()

    for (const commit of currentCommitHashes) {
      if (commit.timestamp >= period.startAt && commit.timestamp < period.endAt) {
        activeRepos.add(commit.repo)
      }
    }

    for (const event of fileChangeEvents) {
      if (event.timestamp < period.startAt || event.timestamp >= period.endAt) {
        continue
      }

      const matchedRepo = repositories.find(repo => event.path.startsWith(repo))
      if (matchedRepo) {
        activeRepos.add(matchedRepo)
      }
    }

    return activeRepos.size || repositories.length
  }

  private countProjectsUpdatedToday(
    repositories: string[],
    fileChangeEvents: Array<Extract<AnalyticsEvent, { type: 'file_change' }>>,
  ): number {
    const today = this.getPeriod('daily', this.formatDateInput(new Date()))
    const activeToday = new Set<string>()

    for (const event of fileChangeEvents) {
      if (event.timestamp < today.startAt || event.timestamp >= today.endAt) {
        continue
      }

      const matchedRepo = repositories.find(repo => event.path.startsWith(repo))
      if (matchedRepo) {
        activeToday.add(matchedRepo)
      }
    }

    return activeToday.size
  }

  private toMetric(current: number, previous: number, kind: 'count' | 'hours'): DashboardStatMetric {
    const trendRatio = previous > 0
      ? ((current - previous) / previous) * 100
      : current > 0
        ? 100
        : 0

    return {
      rawValue: current,
      value: kind === 'hours'
        ? current.toFixed(1)
        : this.formatInteger(current),
      trend: `${trendRatio >= 0 ? '+' : '-'}${Math.abs(trendRatio).toFixed(1)}%`,
    }
  }

  private computeActivityPercent(range: DashboardRange, activeMs: number): number {
    const targetHours = range === 'daily' ? 8 : range === 'weekly' ? 40 : 160
    return Math.max(0, Math.min(100, Math.round((activeMs / 3_600_000 / targetHours) * 100)))
  }

  private getPeriod(range: DashboardRange, selectedDate: string): { startAt: number; endAt: number } {
    const date = this.parseInputDate(selectedDate)
    const start = new Date(date)

    if (range === 'daily') {
      start.setHours(0, 0, 0, 0)
      const end = new Date(start)
      end.setDate(end.getDate() + 1)
      return { startAt: start.getTime(), endAt: end.getTime() }
    }

    if (range === 'weekly') {
      start.setHours(0, 0, 0, 0)
      const day = start.getDay()
      const diff = day === 0 ? 6 : day - 1
      start.setDate(start.getDate() - diff)
      const end = new Date(start)
      end.setDate(end.getDate() + 7)
      return { startAt: start.getTime(), endAt: end.getTime() }
    }

    start.setHours(0, 0, 0, 0)
    start.setDate(1)
    const end = new Date(start)
    end.setMonth(end.getMonth() + 1)
    return { startAt: start.getTime(), endAt: end.getTime() }
  }

  private getPreviousPeriod(period: { startAt: number; endAt: number }): { startAt: number; endAt: number } {
    const duration = period.endAt - period.startAt
    return {
      startAt: period.startAt - duration,
      endAt: period.startAt,
    }
  }

  private parseInputDate(input: string): Date {
    const [year, month, day] = input.split('-').map(Number)
    return new Date(year, (month || 1) - 1, day || 1)
  }

  private formatDateInput(date: Date): string {
    const year = date.getFullYear()
    const month = `${date.getMonth() + 1}`.padStart(2, '0')
    const day = `${date.getDate()}`.padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  private formatInteger(value: number): string {
    return Math.round(value).toLocaleString()
  }
}

export const workspaceAnalyticsService = new WorkspaceAnalyticsService()
