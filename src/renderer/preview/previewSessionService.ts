import { useStore } from '@store'
import type { OpenPreviewMetadata, PreviewServerCandidate, PreviewSession, PreviewSessionStatus } from '@shared/types/preview'
import { buildPreviewDocumentPath, parsePreviewDocumentPath } from '@shared/types/preview'
import { devServerDiscoveryService } from './devServerDiscoveryService'

interface PreviewSessionState {
  sessions: PreviewSession[]
}

type PreviewSessionListener = (state: PreviewSessionState) => void

function createSessionTitle(candidate: PreviewServerCandidate | null, url: string): string {
  if (candidate?.title?.trim()) {
    return candidate.title.trim()
  }

  try {
    const parsed = new URL(url)
    return parsed.port ? `Preview ${parsed.port}` : `Preview ${parsed.host}`
  } catch {
    return 'Preview'
  }
}

export class PreviewSessionService {
  private readonly listeners = new Set<PreviewSessionListener>()
  private readonly sessions = new Map<string, PreviewSession>()
  private readonly sessionByUrl = new Map<string, string>()
  private state: PreviewSessionState = { sessions: [] }

  subscribe(listener: PreviewSessionListener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  getState(): PreviewSessionState {
    return this.state
  }

  getSession(sessionId: string): PreviewSession | null {
    return this.sessions.get(sessionId) || null
  }

  getSessionByPath(path: string): PreviewSession | null {
    const parsed = parsePreviewDocumentPath(path)
    return parsed ? this.getSession(parsed.sessionId) : null
  }

  async openPreferredPreview(workspaceRoots: string[]): Promise<PreviewSession | null> {
    await devServerDiscoveryService.refresh(workspaceRoots)
    const workspaceRoot = workspaceRoots[0] || undefined
    const candidate = devServerDiscoveryService.getPreferredCandidate(workspaceRoot)
    if (!candidate) {
      return null
    }
    return this.openCandidate(candidate)
  }

  openCandidate(candidate: PreviewServerCandidate, options?: { activate?: boolean }): PreviewSession {
    return this.openUrl(candidate.url, {
      title: createSessionTitle(candidate, candidate.url),
      source: candidate.source,
      workspaceRoot: candidate.workspaceRoot,
      candidateId: candidate.id,
      activate: options?.activate,
    })
  }

  openUrl(
    url: string,
    options: {
      title?: string
      source?: PreviewSession['source']
      workspaceRoot?: string
      candidateId?: string
      activate?: boolean
    } = {},
  ): PreviewSession {
    const existingSessionId = this.sessionByUrl.get(url)
    if (existingSessionId) {
      const existingSession = this.sessions.get(existingSessionId)
      if (existingSession) {
        useStore.getState().openPreview({
          sessionId: existingSession.id,
          url: existingSession.url,
          title: existingSession.title,
          source: existingSession.source,
          workspaceRoot: existingSession.workspaceRoot,
          candidateId: existingSession.candidateId,
        }, { activate: options.activate })
        return existingSession
      }
    }

    const session: PreviewSession = {
      id: crypto.randomUUID(),
      url,
      title: options.title || createSessionTitle(null, url),
      source: options.source || 'manual',
      status: 'loading',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      reloadToken: 0,
      workspaceRoot: options.workspaceRoot,
      candidateId: options.candidateId,
    }

    this.sessions.set(session.id, session)
    this.sessionByUrl.set(session.url, session.id)
    this.rebuildState()
    this.emit()

    useStore.getState().openPreview({
      sessionId: session.id,
      url: session.url,
      title: session.title,
      source: session.source,
      workspaceRoot: session.workspaceRoot,
      candidateId: session.candidateId,
    }, { activate: options.activate })

    return session
  }

  restoreSession(preview: OpenPreviewMetadata): void {
    const existing = this.sessions.get(preview.sessionId)
    if (existing) {
      return
    }

    const session: PreviewSession = {
      id: preview.sessionId,
      url: preview.url,
      title: preview.title,
      source: preview.source,
      status: 'loading',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      reloadToken: 0,
      workspaceRoot: preview.workspaceRoot,
      candidateId: preview.candidateId,
    }

    this.sessions.set(session.id, session)
    this.sessionByUrl.set(session.url, session.id)
    this.rebuildState()
    this.emit()
  }

  markStatus(sessionId: string, status: PreviewSessionStatus, error?: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    this.sessions.set(sessionId, {
      ...session,
      status,
      lastError: error,
      updatedAt: Date.now(),
    })
    this.rebuildState()
    this.emit()
  }

  updateTitle(sessionId: string, title: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || !title.trim() || session.title === title.trim()) {
      return
    }

    const nextSession = {
      ...session,
      title: title.trim(),
      updatedAt: Date.now(),
    }
    this.sessions.set(sessionId, nextSession)
    this.rebuildState()
    this.emit()

    const previewPath = buildPreviewDocumentPath(sessionId)
    useStore.getState().updatePreviewMetadata(previewPath, { title: nextSession.title })
  }

  navigate(sessionId: string, url: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || !url.trim()) {
      return
    }

    if (session.url !== url) {
      this.sessionByUrl.delete(session.url)
      this.sessionByUrl.set(url, session.id)
    }

    const nextSession = {
      ...session,
      url,
      status: 'loading' as const,
      updatedAt: Date.now(),
    }
    this.sessions.set(sessionId, nextSession)
    this.rebuildState()
    this.emit()

    const previewPath = buildPreviewDocumentPath(sessionId)
    useStore.getState().updatePreviewMetadata(previewPath, { url })
  }

  reload(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    this.sessions.set(sessionId, {
      ...session,
      status: 'loading',
      reloadToken: session.reloadToken + 1,
      updatedAt: Date.now(),
    })
    this.rebuildState()
    this.emit()
  }

  private rebuildState(): void {
    this.state = {
      sessions: [...this.sessions.values()].sort((left, right) => right.updatedAt - left.updatedAt),
    }
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener(this.state))
  }
}

export const previewSessionService = new PreviewSessionService()
