import { terminalManager } from '@/renderer/services/TerminalManager'
import { api } from '@/renderer/services/electronAPI'
import type { PreviewServerCandidate, PreviewServerSource, PreviewServerStatus } from '@shared/types/preview'

interface DiscoveryState {
  candidates: PreviewServerCandidate[]
  preferredCandidateId: string | null
  lastScanAt: number | null
}

type DiscoveryListener = (state: DiscoveryState) => void

const COMMON_PORTS = [3000, 4173, 4200, 4321, 5173, 8000, 8080, 8081]
const LOCAL_URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d{2,5})?(?:[/?#][^\s"'`<>]*)?/gi

function stripAnsi(value: string): string {
  return value
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[()][AB012B]/g, '')
    .replace(/\x1b[=><]/g, '')
}

function createCandidateId(url: string, workspaceRoot?: string): string {
  return `${workspaceRoot || 'global'}::${url}`.toLowerCase()
}

function deriveCandidateLabel(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.port ? `localhost:${parsed.port}` : parsed.host
  } catch {
    return url
  }
}

function deriveTitle(url: string, source: PreviewServerSource): string {
  const label = deriveCandidateLabel(url)
  if (source === 'terminal') {
    return `Preview ${label}`
  }
  return label
}

function looksLikeHtmlResponse(result: Awaited<ReturnType<typeof api.http.readUrl>>): boolean {
  if (!result.success) return false
  const contentType = (result.contentType || '').toLowerCase()
  return contentType.includes('text/html') || contentType.includes('application/xhtml+xml') || !contentType
}

export class DevServerDiscoveryService {
  private readonly listeners = new Set<DiscoveryListener>()
  private readonly candidates = new Map<string, PreviewServerCandidate>()
  private readonly probeCache = new Map<string, Promise<void>>()
  private readonly scannedTerminalIds = new Set<string>()
  private initialized = false
  private state: DiscoveryState = {
    candidates: [],
    preferredCandidateId: null,
    lastScanAt: null,
  }

  initialize(): void {
    if (this.initialized) {
      return
    }

    this.initialized = true
    terminalManager.onData((terminalId, data) => {
      const terminal = terminalManager.getState().terminals.find((item) => item.id === terminalId)
      this.ingestTerminalOutput(data, terminalId, terminal?.cwd)
    })
  }

  subscribe(listener: DiscoveryListener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  getState(): DiscoveryState {
    return this.state
  }

  getCandidatesForWorkspace(workspaceRoot?: string | null): PreviewServerCandidate[] {
    return this.state.candidates.filter((candidate) => !workspaceRoot || candidate.workspaceRoot === workspaceRoot)
  }

  getPreferredCandidate(workspaceRoot?: string | null): PreviewServerCandidate | null {
    const scopedCandidates = this.getCandidatesForWorkspace(workspaceRoot)
    const readyCandidate = scopedCandidates.find((candidate) => candidate.status === 'ready')
    return readyCandidate || scopedCandidates[0] || null
  }

  async refresh(workspaceRoots: string[]): Promise<void> {
    this.initialize()
    this.scanExistingTerminalBuffers()
    const inferred = await this.inferWorkspaceCandidates(workspaceRoots)
    await Promise.all(inferred.map((candidate) => this.ensureCandidate(candidate)))
    this.state = {
      ...this.state,
      lastScanAt: Date.now(),
    }
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
      const packageJsonPath = `${workspaceRoot}/package.json`
      const packageJson = await api.file.read(packageJsonPath)
      const ports = new Set<number>()

      if (packageJson) {
        try {
          const parsed = JSON.parse(packageJson) as {
            scripts?: Record<string, string>
            dependencies?: Record<string, string>
            devDependencies?: Record<string, string>
          }
          const scripts = Object.values(parsed.scripts || {}).join('\n')
          const dependencies = {
            ...(parsed.dependencies || {}),
            ...(parsed.devDependencies || {}),
          }

          if (/vite/i.test(scripts) || dependencies.vite) {
            ports.add(5173)
            ports.add(4173)
          }
          if (/next\s+dev/i.test(scripts) || dependencies.next) {
            ports.add(3000)
          }
          if (/nuxt/i.test(scripts) || dependencies.nuxt || dependencies.nuxi) {
            ports.add(3000)
          }
          if (/ng\s+serve/i.test(scripts) || dependencies['@angular/core']) {
            ports.add(4200)
          }
          if (/react-scripts\s+start/i.test(scripts) || dependencies['react-scripts']) {
            ports.add(3000)
          }
          if (/astro/i.test(scripts) || dependencies.astro) {
            ports.add(4321)
          }

          const explicitPorts = [...scripts.matchAll(/(?:--port|-p)\s+(\d{2,5})/g)].map((match) => Number(match[1]))
          explicitPorts.forEach((port) => ports.add(port))
        } catch {
          // Ignore malformed package.json and fall back to common ports.
        }
      }

      if (ports.size === 0) {
        COMMON_PORTS.forEach((port) => ports.add(port))
      }

      for (const port of [...ports].slice(0, 6)) {
        const url = `http://127.0.0.1:${port}`
        inferredCandidates.push(this.buildCandidate(url, 'workspace-script', workspaceRoot))
      }
    }

    return inferredCandidates
  }

  private ingestTerminalOutput(output: string, terminalId: string, workspaceRoot?: string): void {
    const normalizedOutput = stripAnsi(output)
    const urls = normalizedOutput.match(LOCAL_URL_PATTERN) || []
    if (urls.length === 0) {
      return
    }

    urls.forEach((url) => {
      void this.ensureCandidate(this.buildCandidate(url.replace(/\/$/, ''), 'terminal', workspaceRoot, terminalId))
    })
  }

  private buildCandidate(
    url: string,
    source: PreviewServerSource,
    workspaceRoot?: string,
    terminalId?: string,
  ): PreviewServerCandidate {
    const now = Date.now()
    return {
      id: createCandidateId(url, workspaceRoot),
      url,
      source,
      status: 'idle',
      label: deriveCandidateLabel(url),
      title: deriveTitle(url, source),
      terminalId,
      workspaceRoot,
      detectedAt: now,
      lastSeenAt: now,
    }
  }

  private async ensureCandidate(candidate: PreviewServerCandidate): Promise<void> {
    const existing = this.candidates.get(candidate.id)
    const mergedCandidate: PreviewServerCandidate = existing
      ? {
          ...existing,
          ...candidate,
          status: existing.status,
          detectedAt: Math.min(existing.detectedAt, candidate.detectedAt),
          lastSeenAt: Date.now(),
        }
      : candidate

    this.candidates.set(candidate.id, mergedCandidate)
    this.rebuildState()
    this.emit()

    if (!this.probeCache.has(candidate.id)) {
      this.probeCache.set(candidate.id, this.probeCandidate(candidate.id))
    }

    await this.probeCache.get(candidate.id)
  }

  private async probeCandidate(candidateId: string): Promise<void> {
    const candidate = this.candidates.get(candidateId)
    if (!candidate) {
      return
    }

    this.updateCandidate(candidateId, {
      status: 'probing',
      lastCheckedAt: Date.now(),
      error: undefined,
    })

    try {
      const result = await api.http.readUrl(candidate.url, 1200)
      const nextStatus: PreviewServerStatus = looksLikeHtmlResponse(result) ? 'ready' : 'unreachable'
      this.updateCandidate(candidateId, {
        status: nextStatus,
        title: result.title || candidate.title,
        lastCheckedAt: Date.now(),
        error: nextStatus === 'ready' ? undefined : result.error || 'Not an HTML dev server',
      })
    } catch (error) {
      this.updateCandidate(candidateId, {
        status: 'unreachable',
        lastCheckedAt: Date.now(),
        error: error instanceof Error ? error.message : 'Probe failed',
      })
    } finally {
      this.probeCache.delete(candidateId)
    }
  }

  private updateCandidate(candidateId: string, updates: Partial<PreviewServerCandidate>): void {
    const candidate = this.candidates.get(candidateId)
    if (!candidate) {
      return
    }

    this.candidates.set(candidateId, {
      ...candidate,
      ...updates,
    })
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
      return right.lastSeenAt - left.lastSeenAt
    })

    this.state = {
      ...this.state,
      candidates,
      preferredCandidateId: candidates.find((candidate) => candidate.status === 'ready')?.id || candidates[0]?.id || null,
    }
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener(this.state))
  }
}

export const devServerDiscoveryService = new DevServerDiscoveryService()
