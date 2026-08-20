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

/** 主进程探活单个本地端口的结果。 */
export interface PreviewProbeResult {
  ok: boolean
  /** HTTP 状态码；连接失败时缺省 */
  statusCode?: number
  contentType?: string
  title?: string
  error?: string
  /**
   * 实际连通的地址。
   *
   * 只监听 ::1 的服务用 127.0.0.1 连不上，探活会退回 localhost 重试；
   * 这时返回的地址与请求的地址不同，调用方应该用这个去导航。
   */
  resolvedUrl?: string
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
  /** guest 的导航历史状态，由 webview 事件同步 */
  canGoBack?: boolean
  canGoForward?: boolean
  faviconUrl?: string
  /** 加载失败时的 Chromium errorCode，用于区分"服务没起来"和"页面自己报错" */
  lastErrorCode?: number
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

