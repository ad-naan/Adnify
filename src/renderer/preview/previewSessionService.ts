import { useStore } from '@store'
import type { OpenPreviewMetadata, PreviewServerCandidate, PreviewSession, PreviewSessionStatus } from '@shared/types/preview'
import { buildPreviewDocumentPath, parsePreviewDocumentPath } from '@shared/types/preview'
import { formatPreviewOriginLabel, parseLocalPreviewOrigin } from '@shared/preview/discovery'
import { devServerDiscoveryService } from './devServerDiscoveryService'
import { previewWorkspaceKey } from '@shared/preview/device'

const sessionUrlKey = (url: string, root?: string) => JSON.stringify([previewWorkspaceKey(root), url])

interface PreviewSessionState {
  sessions: PreviewSession[]
}

type PreviewSessionListener = (state: PreviewSessionState) => void

function createSessionTitle(candidate: PreviewServerCandidate | null, url: string): string {
  if (candidate?.title?.trim()) {
    return candidate.title.trim()
  }

  const origin = parseLocalPreviewOrigin(url)
  return origin ? `Preview ${formatPreviewOriginLabel(origin)}` : 'Preview'
}

export class PreviewSessionService {
  private readonly listeners = new Set<PreviewSessionListener>()
  private readonly sessions = new Map<string, PreviewSession>()
  /** Project + URL: identical localhost addresses in different projects stay separate. */
  private readonly sessionByUrl = new Map<string, string>()
  private state: PreviewSessionState = { sessions: [] }

  subscribe(listener: PreviewSessionListener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => {
      this.listeners.delete(listener)
    }
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
    await devServerDiscoveryService.refresh(workspaceRoots, { force: true })
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
    const workspaceRoot = options.workspaceRoot ?? useStore.getState().workspace?.roots?.[0]
    const key = sessionUrlKey(url, workspaceRoot)
    const existingSessionId = this.sessionByUrl.get(key)
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
      // 索引指向了已销毁的会话，清掉再新建。
      this.sessionByUrl.delete(key)
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
      workspaceRoot,
      candidateId: options.candidateId,
      canGoBack: false,
      canGoForward: false,
    }

    this.sessions.set(session.id, session)
    this.sessionByUrl.set(key, session.id)
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
      workspaceRoot: preview.workspaceRoot ?? useStore.getState().workspace?.roots?.[0],
      candidateId: preview.candidateId,
      canGoBack: false,
      canGoForward: false,
    }

    this.sessions.set(session.id, session)
    this.sessionByUrl.set(sessionUrlKey(session.url, session.workspaceRoot), session.id)
    this.rebuildState()
    this.emit()
  }

  /**
   * 关闭预览标签时释放会话。
   *
   * 之前没有这一步：sessions / sessionByUrl 只增不减，关掉标签再打开同一地址会
   * 命中一个没有任何 UI 挂载的僵尸会话，reloadToken 也永远不归零。
   */
  disposeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    this.sessions.delete(sessionId)
    const key = sessionUrlKey(session.url, session.workspaceRoot)
    if (this.sessionByUrl.get(key) === sessionId) {
      this.sessionByUrl.delete(key)
    }
    this.rebuildState()
    this.emit()
  }

  disposeSessionByPath(path: string): void {
    const parsed = parsePreviewDocumentPath(path)
    if (parsed) {
      this.disposeSession(parsed.sessionId)
    }
  }

  /**
   * 以当前打开的 preview 标签为准，回收其余会话。
   *
   * 用对账而不是在 closeFile 里挂钩子：关闭路径有好几条（标签 X、关闭其他、
   * 关闭右侧、workspace 切换），逐个挂钩子早晚漏一个。
   */
  pruneSessions(openSessionIds: Iterable<string>): void {
    const keep = new Set(openSessionIds)
    for (const sessionId of [...this.sessions.keys()]) {
      if (!keep.has(sessionId)) {
        this.disposeSession(sessionId)
      }
    }
  }

  markStatus(sessionId: string, status: PreviewSessionStatus, error?: string, errorCode?: number): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    this.sessions.set(sessionId, {
      ...session,
      status,
      lastError: error,
      lastErrorCode: errorCode,
      updatedAt: Date.now(),
    })
    this.rebuildState()
    this.emit()
  }

  /** 同步 guest 的导航历史可用性，驱动前进/后退按钮的 disabled 状态。 */
  updateNavigationState(sessionId: string, navigation: { canGoBack: boolean; canGoForward: boolean }): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }
    if (session.canGoBack === navigation.canGoBack && session.canGoForward === navigation.canGoForward) {
      return
    }

    this.sessions.set(sessionId, { ...session, ...navigation, updatedAt: Date.now() })
    this.rebuildState()
    this.emit()
  }

  updateFavicon(sessionId: string, faviconUrl: string | undefined): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.faviconUrl === faviconUrl) {
      return
    }

    this.sessions.set(sessionId, { ...session, faviconUrl, updatedAt: Date.now() })
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

    useStore.getState().updatePreviewMetadata(buildPreviewDocumentPath(sessionId), { title: nextSession.title })
  }

  /**
   * 记录 guest 已经到达的地址。
   *
   * 与 navigate() 的区别：这个方法不请求导航，只把已经发生的跳转（用户点链接、
   * 框架重定向）同步进 store，所以不动 status，也不碰 reloadToken。
   */
  syncNavigated(sessionId: string, url: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || !url.trim() || session.url === url) {
      return
    }

    this.remapUrl(session, url)
    this.sessions.set(sessionId, { ...session, url, updatedAt: Date.now() })
    this.rebuildState()
    this.emit()

    useStore.getState().updatePreviewMetadata(buildPreviewDocumentPath(sessionId), { url })
  }

  navigate(sessionId: string, url: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || !url.trim()) {
      return
    }

    this.remapUrl(session, url)

    const nextSession: PreviewSession = {
      ...session,
      url,
      status: 'loading',
      lastError: undefined,
      lastErrorCode: undefined,
      updatedAt: Date.now(),
    }
    this.sessions.set(sessionId, nextSession)
    this.rebuildState()
    this.emit()

    useStore.getState().updatePreviewMetadata(buildPreviewDocumentPath(sessionId), { url })
  }

  reload(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    this.sessions.set(sessionId, {
      ...session,
      status: 'loading',
      lastError: undefined,
      lastErrorCode: undefined,
      reloadToken: session.reloadToken + 1,
      updatedAt: Date.now(),
    })
    this.rebuildState()
    this.emit()
  }

  private remapUrl(session: PreviewSession, nextUrl: string): void {
    if (session.url === nextUrl) return
    const previousKey = sessionUrlKey(session.url, session.workspaceRoot)
    if (this.sessionByUrl.get(previousKey) === session.id) {
      this.sessionByUrl.delete(previousKey)
    }
    this.sessionByUrl.set(sessionUrlKey(nextUrl, session.workspaceRoot), session.id)
  }

  private rebuildState(): void {
    this.state = {
      sessions: [...this.sessions.values()].sort((left, right) => right.updatedAt - left.updatedAt),
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state)
    }
  }
}

export const previewSessionService = new PreviewSessionService()
