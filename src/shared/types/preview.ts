export type PreviewServerSource = 'terminal' | 'workspace-script' | 'port-probe' | 'manual'

export type PreviewServerStatus = 'idle' | 'probing' | 'ready' | 'unreachable'

export interface PreviewServerCandidate {
  id: string
  url: string
  source: PreviewServerSource
  status: PreviewServerStatus
  label?: string
  title?: string
  terminalId?: string
  workspaceRoot?: string
  detectedAt: number
  lastSeenAt: number
  lastCheckedAt?: number
  error?: string
}

export type PreviewSessionStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface PreviewSession {
  id: string
  url: string
  title: string
  source: PreviewServerSource
  status: PreviewSessionStatus
  createdAt: number
  updatedAt: number
  reloadToken: number
  workspaceRoot?: string
  candidateId?: string
  lastError?: string
}

export interface OpenPreviewMetadata {
  sessionId: string
  url: string
  title: string
  source: PreviewServerSource
  workspaceRoot?: string
  candidateId?: string
}

export function buildPreviewDocumentPath(sessionId: string): string {
  return `preview://session/${sessionId}`
}

export function isPreviewDocumentPath(path: string): boolean {
  return typeof path === 'string' && path.startsWith('preview://session/')
}

export function parsePreviewDocumentPath(path: string): { sessionId: string } | null {
  if (!isPreviewDocumentPath(path)) {
    return null
  }

  const sessionId = path.slice('preview://session/'.length)
  return sessionId ? { sessionId } : null
}

