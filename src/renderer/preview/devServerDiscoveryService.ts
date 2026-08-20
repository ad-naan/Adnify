/**
 * 本地 dev server 发现。
 *
 * 三个来源：终端输出里打印的地址、package.json 推断出的常用端口、用户手输。
 * 所有候选都折叠到 origin 粒度（protocol + port），因为 dev server 的日志会
 * 持续刷出同端口的 HMR / 静态资源 URL —— 按完整 URL 建候选会得到几十个"新服务"。
 */

import { terminalManager } from '@/renderer/services/TerminalManager'
import { api } from '@/renderer/services/electronAPI'
import {
  extractLocalPreviewOrigins,
  formatPreviewOriginLabel,
  parseLocalPreviewOrigin,
  stripAnsi,
  type LocalPreviewOrigin,
} from '@shared/preview/discovery'
import type { PreviewServerCandidate, PreviewServerSource } from '@shared/types/preview'

interface DiscoveryState {
  candidates: PreviewServerCandidate[]
  preferredCandidateId: string | null
  lastScanAt: number | null
  scanning: boolean
}

type DiscoveryListener = (state: DiscoveryState) => void

/** 没有框架线索时的兜底端口。顺序即优先级。 */
const COMMON_PORTS = [5173, 3000, 8080, 4200, 4321, 8000]

/** 单个工作区最多推断几个端口 —— 每个端口都是一次探活。 */
const MAX_INFERRED_PORTS = 6

/** 候选总数上限，防止长时间跑着的终端把列表堆爆。 */
const MAX_CANDIDATES = 24

/** 同一候选的最小重探间隔。终端刷日志时不该每行都触发一次探活。 */
const REPROBE_INTERVAL_MS = 5000

/** refresh() 的最小间隔，避免 UI 多处订阅时并发全量扫描。 */
const REFRESH_THROTTLE_MS = 1500

const PROBE_TIMEOUT_MS = 1500

function candidateId(origin: LocalPreviewOrigin): string {
  return origin.key
}

function deriveTitle(origin: LocalPreviewOrigin): string {
  return `Preview ${formatPreviewOriginLabel(origin)}`
}

export class DevServerDiscoveryService {
  private readonly listeners = new Set<DiscoveryListener>()
  private readonly candidates = new Map<string, PreviewServerCandidate>()
  private readonly inFlightProbes = new Map<string, Promise<void>>()
  private readonly scannedTerminalIds = new Set<string>()
  private terminalUnsubscribe: (() => void) | null = null
  private initialized = false
  private lastRefreshAt = 0
  private pendingRefresh: Promise<void> | null = null
  private state: DiscoveryState = {
    candidates: [],
    preferredCandidateId: null,
    lastScanAt: null,
    scanning: false,
  }

  initialize(): void {
    if (this.initialized) {
      return
    }

    this.initialized = true
    this.terminalUnsubscribe = terminalManager.onData((terminalId, data) => {
      const terminal = terminalManager.getState().terminals.find((item) => item.id === terminalId)
      this.ingestTerminalOutput(data, terminalId, terminal?.cwd)
    })
  }

  /** 测试与热重载用：断开终端订阅并清空候选。 */
  dispose(): void {
    this.terminalUnsubscribe?.()
    this.terminalUnsubscribe = null
    this.initialized = false
    this.candidates.clear()
    this.inFlightProbes.clear()
    this.scannedTerminalIds.clear()
    this.lastRefreshAt = 0
    this.pendingRefresh = null
    this.rebuildState()
    this.emit()
  }

  subscribe(listener: DiscoveryListener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState(): DiscoveryState {
    return this.state
  }

  getCandidatesForWorkspace(workspaceRoot?: string | null): PreviewServerCandidate[] {
    if (!workspaceRoot) return this.state.candidates
    // 终端来源的候选可能没有 cwd（用户在别处启动），这类候选对所有工作区都可见。
    return this.state.candidates.filter(
      (candidate) => !candidate.workspaceRoot || candidate.workspaceRoot === workspaceRoot,
    )
  }

  getReadyCandidates(workspaceRoot?: string | null): PreviewServerCandidate[] {
    return this.getCandidatesForWorkspace(workspaceRoot).filter((candidate) => candidate.status === 'ready')
  }

  getPreferredCandidate(workspaceRoot?: string | null): PreviewServerCandidate | null {
    const scoped = this.getCandidatesForWorkspace(workspaceRoot)
    return scoped.find((candidate) => candidate.status === 'ready') || scoped[0] || null
  }

  /**
   * 手动加入一个候选（地址栏输入 / 恢复会话）。返回规范化后的候选，非本地地址返回 null。
   */
  registerManualUrl(url: string, workspaceRoot?: string): PreviewServerCandidate | null {
    const origin = parseLocalPreviewOrigin(url)
    if (!origin) return null

    const candidate = this.buildCandidate(origin, 'manual', workspaceRoot)
    this.upsertCandidate(candidate)
    void this.probeCandidate(candidate.id)
    return this.candidates.get(candidate.id) || candidate
  }

  async refresh(workspaceRoots: string[], options?: { force?: boolean }): Promise<void> {
    this.initialize()

    const now = Date.now()
    if (!options?.force) {
      if (this.pendingRefresh) return this.pendingRefresh
      if (now - this.lastRefreshAt < REFRESH_THROTTLE_MS) return
    }

    this.lastRefreshAt = now
    this.setScanning(true)

    const run = (async () => {
      try {
        this.scanExistingTerminalBuffers()
        const inferred = await this.inferWorkspaceCandidates(workspaceRoots)
        for (const candidate of inferred) {
          this.upsertCandidate(candidate)
        }
        await Promise.all([...new Set(inferred.map((candidate) => candidate.id))].map((id) => this.probeCandidate(id)))
      } finally {
        this.state = { ...this.state, lastScanAt: Date.now() }
        this.setScanning(false)
        this.pendingRefresh = null
      }
    })()

    this.pendingRefresh = run
    return run
  }

  private setScanning(scanning: boolean): void {
    if (this.state.scanning === scanning) return
    this.state = { ...this.state, scanning }
    this.emit()
  }

  private scanExistingTerminalBuffers(): void {
    const { terminals } = terminalManager.getState()
    for (const terminal of terminals) {
      if (this.scannedTerminalIds.has(terminal.id)) {
        continue
      }
      this.scannedTerminalIds.add(terminal.id)
      const buffer = terminalManager.getOutputBuffer(terminal.id).join('')
      if (buffer) {
        this.ingestTerminalOutput(buffer, terminal.id, terminal.cwd)
      }
    }
  }

  private async inferWorkspaceCandidates(workspaceRoots: string[]): Promise<PreviewServerCandidate[]> {
    const inferredCandidates: PreviewServerCandidate[] = []

    for (const workspaceRoot of workspaceRoots) {
      const ports = await this.inferPortsForWorkspace(workspaceRoot)
      for (const port of [...ports].slice(0, MAX_INFERRED_PORTS)) {
        const origin = parseLocalPreviewOrigin(`http://127.0.0.1:${port}`)
        if (origin) {
          inferredCandidates.push(this.buildCandidate(origin, 'workspace-script', workspaceRoot))
        }
      }
    }

    return inferredCandidates
  }

  private async inferPortsForWorkspace(workspaceRoot: string): Promise<Set<number>> {
    const ports = new Set<number>()
    const packageJson = await api.file.read(`${workspaceRoot}/package.json`).catch(() => null)

    if (packageJson) {
      try {
        const parsed = JSON.parse(packageJson) as {
          scripts?: Record<string, string>
          dependencies?: Record<string, string>
          devDependencies?: Record<string, string>
        }
        const scripts = Object.values(parsed.scripts || {}).join('\n')
        const dependencies = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) }

        if (/vite/i.test(scripts) || dependencies.vite) {
          ports.add(5173)
          ports.add(4173)
        }
        if (/next\s+dev/i.test(scripts) || dependencies.next) ports.add(3000)
        if (/nuxt/i.test(scripts) || dependencies.nuxt || dependencies.nuxi) ports.add(3000)
        if (/ng\s+serve/i.test(scripts) || dependencies['@angular/core']) ports.add(4200)
        if (/react-scripts\s+start/i.test(scripts) || dependencies['react-scripts']) ports.add(3000)
        if (/astro/i.test(scripts) || dependencies.astro) ports.add(4321)
        if (/svelte-kit|vite dev/i.test(scripts) || dependencies['@sveltejs/kit']) ports.add(5173)

        // 显式 --port / -p 覆盖框架默认值，优先级更高，所以放在最后加入。
        for (const match of scripts.matchAll(/(?:--port[= ]|-p\s+)(\d{2,5})/g)) {
          const port = Number(match[1])
          if (Number.isInteger(port) && port > 0 && port <= 65535) ports.add(port)
        }
      } catch {
        // package.json 坏了就退回兜底端口。
      }
    }

    if (ports.size === 0) {
      COMMON_PORTS.forEach((port) => ports.add(port))
    }

    return ports
  }

  private ingestTerminalOutput(output: string, terminalId: string, workspaceRoot?: string): void {
    const origins = extractLocalPreviewOrigins(stripAnsi(output))
    if (origins.length === 0) {
      return
    }

    for (const origin of origins) {
      const candidate = this.buildCandidate(origin, 'terminal', workspaceRoot, terminalId)
      const existing = this.candidates.get(candidate.id)
      this.upsertCandidate(candidate)

      // 已经确认 ready 且刚探过的候选不再重探 —— 日志刷屏时这是主要的开销来源。
      const lastCheckedAt = existing?.lastCheckedAt ?? 0
      if (Date.now() - lastCheckedAt >= REPROBE_INTERVAL_MS) {
        void this.probeCandidate(candidate.id)
      }
    }
  }

  private buildCandidate(
    origin: LocalPreviewOrigin,
    source: PreviewServerSource,
    workspaceRoot?: string,
    terminalId?: string,
  ): PreviewServerCandidate {
    const now = Date.now()
    return {
      id: candidateId(origin),
      url: origin.origin,
      source,
      status: 'idle',
      label: formatPreviewOriginLabel(origin),
      title: deriveTitle(origin),
      terminalId,
      workspaceRoot,
      detectedAt: now,
      lastSeenAt: now,
    }
  }

  private upsertCandidate(candidate: PreviewServerCandidate): void {
    const existing = this.candidates.get(candidate.id)

    const merged: PreviewServerCandidate = existing
      ? {
          ...existing,
          // 终端来源比推断来源更可信：真的看到服务打印了地址。
          source: candidate.source === 'terminal' ? 'terminal' : existing.source,
          workspaceRoot: existing.workspaceRoot || candidate.workspaceRoot,
          terminalId: candidate.terminalId || existing.terminalId,
          label: candidate.label || existing.label,
          detectedAt: Math.min(existing.detectedAt, candidate.detectedAt),
          lastSeenAt: Date.now(),
        }
      : candidate

    this.candidates.set(candidate.id, merged)
    this.evictOverflow()
    this.rebuildState()
    this.emit()
  }

  /** 超出上限时先丢不可达、最久未见的候选。 */
  private evictOverflow(): void {
    if (this.candidates.size <= MAX_CANDIDATES) return

    const sorted = [...this.candidates.values()].sort((left, right) => {
      const leftDead = left.status === 'unreachable' ? 0 : 1
      const rightDead = right.status === 'unreachable' ? 0 : 1
      if (leftDead !== rightDead) return leftDead - rightDead
      return left.lastSeenAt - right.lastSeenAt
    })

    for (const candidate of sorted.slice(0, this.candidates.size - MAX_CANDIDATES)) {
      this.candidates.delete(candidate.id)
      this.inFlightProbes.delete(candidate.id)
    }
  }

  private async probeCandidate(candidateId: string): Promise<void> {
    const inFlight = this.inFlightProbes.get(candidateId)
    if (inFlight) return inFlight

    const candidate = this.candidates.get(candidateId)
    if (!candidate) return

    const probe = (async () => {
      this.updateCandidate(candidateId, { status: 'probing', error: undefined })

      try {
        const result = await api.preview.probe(candidate.url, PROBE_TIMEOUT_MS)
        this.updateCandidate(candidateId, {
          status: result.ok ? 'ready' : 'unreachable',
          // 服务只监听 ::1 时探活会退回 localhost，用真正连通的那个地址导航。
          url: result.ok && result.resolvedUrl ? result.resolvedUrl : candidate.url,
          // 用页面 <title>，拿不到就保留原来的 "Preview host:port"。
          title: result.title?.trim() || candidate.title,
          lastCheckedAt: Date.now(),
          error: result.ok ? undefined : result.error || 'Unreachable',
        })
      } catch (error) {
        this.updateCandidate(candidateId, {
          status: 'unreachable',
          lastCheckedAt: Date.now(),
          error: error instanceof Error ? error.message : 'Probe failed',
        })
      } finally {
        this.inFlightProbes.delete(candidateId)
      }
    })()

    this.inFlightProbes.set(candidateId, probe)
    return probe
  }

  private updateCandidate(candidateId: string, updates: Partial<PreviewServerCandidate>): void {
    const candidate = this.candidates.get(candidateId)
    if (!candidate) {
      return
    }

    this.candidates.set(candidateId, { ...candidate, ...updates })
    this.rebuildState()
    this.emit()
  }

  private rebuildState(): void {
    const candidates = [...this.candidates.values()].sort((left, right) => {
      const leftReady = left.status === 'ready' ? 1 : 0
      const rightReady = right.status === 'ready' ? 1 : 0
      if (rightReady !== leftReady) {
        return rightReady - leftReady
      }
      // 终端里真的打印过的地址排在推断出来的前面。
      const leftTerminal = left.source === 'terminal' ? 1 : 0
      const rightTerminal = right.source === 'terminal' ? 1 : 0
      if (rightTerminal !== leftTerminal) {
        return rightTerminal - leftTerminal
      }
      return right.lastSeenAt - left.lastSeenAt
    })

    this.state = {
      ...this.state,
      candidates,
      preferredCandidateId: candidates.find((candidate) => candidate.status === 'ready')?.id
        || candidates[0]?.id
        || null,
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state)
    }
  }
}

export const devServerDiscoveryService = new DevServerDiscoveryService()
