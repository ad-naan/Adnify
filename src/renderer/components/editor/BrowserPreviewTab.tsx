/**
 * 内置预览标签页。
 *
 * 用 Electron `<webview>` 而不是 iframe：iframe 给不出导航历史、拿不到
 * 加载失败的原因（onError 对跨源导航根本不触发），也无法在 dev server 挂掉时
 * 区分"服务没起来"和"页面自己报错"。guest 的安全配置在主进程由
 * security/webviewGuard.ts 强制收敛。
 *
 * webview 的方法（loadURL / canGoBack / setZoomLevel …）在 guest 附着并触发
 * dom-ready 之前调用会抛异常，所以本文件里所有对 guest 的调用都必须经过
 * callGuest / navigateGuest 这两个入口。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  Check,
  Copy,
  ExternalLink,
  Globe,
  RefreshCw,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useStore } from '@store'
import type { OpenFile } from '@store'
import { Button } from '../ui'
import { api } from '@/renderer/services/electronAPI'
import { t, type Language } from '@shared/i18n'
import { previewSessionService } from '@/renderer/preview/previewSessionService'
import { devServerDiscoveryService } from '@/renderer/preview/devServerDiscoveryService'
import { loadPreviewSettings, updatePreviewSettings } from '@/renderer/preview/previewSettings'
import { isBrowserPreviewUrl } from '@shared/preview/discovery'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'
import type {
  PreviewWebviewElement,
  PreviewWebviewFailLoadEvent,
  PreviewWebviewFaviconEvent,
  PreviewWebviewNavigateEvent,
  PreviewWebviewTitleEvent,
} from '@/renderer/types/webview'

interface BrowserPreviewTabProps {
  file: OpenFile
}

/**
 * guest 会话分区。
 *
 * 用独立的 persist: 分区，让预览的 cookie / localStorage 与主窗口彻底隔开，
 * 同时在重启后保留登录态 —— 本地后台管理页面常常需要登录才能看。
 */
const PREVIEW_PARTITION = 'persist:adnify-preview'

// React's webview typings only accept boolean, but its DOM serializer drops
// unknown boolean attributes. Supply Electron's native attribute as a string.
const PREVIEW_WEBVIEW_ATTRIBUTES: Record<string, string> = { allowpopups: '' }

/** Chromium net error：连不上服务，区别于页面自身 4xx/5xx。 */
const CONNECTION_ERROR_CODES = new Set([-2, -102, -105, -106, -109, -118, -324])

/** webview 的 setZoomLevel 每级 ±20%，限制在一个还能看清的范围里。 */
const MIN_ZOOM_LEVEL = -3
const MAX_ZOOM_LEVEL = 3

function sanitizeUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return /^[a-z][a-z\d+.-]*:(?!\d)/i.test(trimmed) ? trimmed : `http://${trimmed}`
}

export default function BrowserPreviewTab({ file }: BrowserPreviewTabProps) {
  const workspace = useStore((state) => state.workspace)
  const language = (useStore((state) => state.language) || 'en') as Language
  const preview = file.preview

  const webviewRef = useRef<PreviewWebviewElement | null>(null)
  /**
   * guest 是否已经 attach 并触发过 dom-ready。
   *
   * webview 的所有 webContents 方法在这之前都会抛
   * "The WebView must be attached to the DOM and the dom-ready event emitted"。
   * 组件挂载时的 effect 一定跑在 dom-ready 之前，所以初始导航只能靠 src 属性，
   * 不能在 effect 里 loadURL。
   */
  const guestReadyRef = useRef(false)
  /**
   * webview 已经真实到达的地址。
   *
   * 用来判断"这次 session.url 变化是否需要主动导航" —— 如果变化本身来自
   * guest 的 did-navigate，再导航一次会把用户点进去的页面弹回去。
   * 初始值就是首帧 src，因为那次导航由属性完成，不需要再 loadURL。
   */
  const committedUrlRef = useRef<string>(preview?.url || '')
  /** dom-ready 之前积压的一次导航请求。 */
  const pendingUrlRef = useRef<string | null>(null)

  const [session, setSession] = useState(() => (preview ? previewSessionService.getSession(preview.sessionId) : null))
  const [discoveryState, setDiscoveryState] = useState(() => devServerDiscoveryService.getState())
  const [addressInput, setAddressInput] = useState(preview?.url || '')
  const [addressError, setAddressError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(() => loadPreviewSettings().zoomLevel)
  /** dom-ready 处理器要读最新缩放值，但不该因为缩放变化重绑所有监听。 */
  const zoomLevelRef = useRef(zoomLevel)
  zoomLevelRef.current = zoomLevel

  const sessionId = preview?.sessionId

  /**
   * 本次 guest 挂载时的初始地址。
   *
   * webview 的首次导航只能靠 src 属性（dom-ready 之前 loadURL 会抛），而 src
   * 之后绝不能再随 session.url 变化 —— React 改 src 属性本身就会触发一次导航，
   * 和 loadURL 撞成双重跳转。所以这里只在会话切换时重算。
   *
   * Editor 复用同一个组件实例渲染不同的预览标签，因此必须以 sessionId 为界。
   * 取地址只能用 preview（来自 file，与新 sessionId 同步），不能用 session ——
   * 切换标签的那一次渲染里 session 还是上一个标签的。
   */
  const mountRef = useRef<{ sessionId: string | undefined; url: string }>({
    sessionId,
    url: preview?.url || '',
  })
  if (mountRef.current.sessionId !== sessionId) {
    mountRef.current = { sessionId, url: preview?.url || '' }
    committedUrlRef.current = mountRef.current.url
    guestReadyRef.current = false
    pendingUrlRef.current = null
  }

  /** guest 尚未就绪时静默跳过，避免把整个编辑器炸掉。 */
  const callGuest = useCallback(<T,>(action: (element: PreviewWebviewElement) => T): T | undefined => {
    const element = webviewRef.current
    if (!element || !guestReadyRef.current) return undefined
    try {
      return action(element)
    } catch {
      // guest 可能正在重建（分区切换、崩溃恢复），下一次 dom-ready 会重新对齐状态。
      return undefined
    }
  }, [])

  /** 导航到指定地址；guest 未就绪时先记下，dom-ready 后补发。 */
  const navigateGuest = useCallback((url: string) => {
    committedUrlRef.current = url

    const element = webviewRef.current
    if (!element || !guestReadyRef.current) {
      pendingUrlRef.current = url
      return
    }

    pendingUrlRef.current = null
    void element.loadURL(url).catch(() => {
      // 失败会走 did-fail-load，那里已经落了状态。
    })
  }, [])

  useEffect(() => {
    if (!preview) return
    previewSessionService.restoreSession(preview)
    setSession(previewSessionService.getSession(preview.sessionId))
    setAddressInput(preview.url)
  }, [preview])

  useEffect(() => previewSessionService.subscribe((state) => {
    if (!sessionId) return
    setSession(state.sessions.find((item) => item.id === sessionId) || null)
  }), [sessionId])

  useEffect(() => devServerDiscoveryService.subscribe(setDiscoveryState), [])

  const workspaceRootsKey = (workspace?.roots || []).join('|')
  useEffect(() => {
    const roots = workspaceRootsKey ? workspaceRootsKey.split('|') : []
    if (roots.length > 0) {
      void devServerDiscoveryService.refresh(roots)
    }
  }, [workspaceRootsKey])

  const workspaceRoot = preview?.workspaceRoot || workspace?.roots?.[0]
  const scopedCandidates = useMemo(
    () => devServerDiscoveryService.getCandidatesForWorkspace(workspaceRoot).slice(0, 6),
    [discoveryState, workspaceRoot],
  )

  /**
   * 当前标签的会话。
   *
   * `session` 是 state，切换预览标签的那一次渲染里它还是上一个标签的值 ——
   * 直接用会让工具栏短暂显示别人的地址、历史与错误。id 不匹配时按"还没加载"处理。
   */
  const activeSession = session && session.id === sessionId ? session : null

  const syncNavigationState = useCallback(() => {
    if (!sessionId) return
    const navigation = callGuest((element) => ({
      canGoBack: element.canGoBack(),
      canGoForward: element.canGoForward(),
    }))
    if (navigation) {
      previewSessionService.updateNavigationState(sessionId, navigation)
    }
  }, [callGuest, sessionId])

  /**
   * 绑定 guest 事件。
   *
   * webview 的事件是 DOM 事件而不是 React 的 on* prop，必须手工 addEventListener。
   * 依赖只有 sessionId：这些处理器都通过 ref 读最新值，把 zoomLevel 之类的
   * 状态放进依赖会导致每次改缩放都解绑重绑一整套监听。
   */
  useEffect(() => {
    const element = webviewRef.current
    if (!element || !sessionId) return

    const handleStartLoading = () => {
      previewSessionService.markStatus(sessionId, 'loading')
    }

    const handleStopLoading = () => {
      syncNavigationState()
    }

    const handleDomReady = () => {
      guestReadyRef.current = true

      // zoom 必须在 dom-ready 之后设置。
      callGuest((guest) => guest.setZoomLevel(zoomLevelRef.current))

      // dom-ready 之前积压的导航在这里补发。
      const pending = pendingUrlRef.current
      if (pending && pending !== element.getURL()) {
        pendingUrlRef.current = null
        void element.loadURL(pending).catch(() => {})
        return
      }
      pendingUrlRef.current = null
      syncNavigationState()
    }

    const handleFinishLoad = () => {
      previewSessionService.markStatus(sessionId, 'ready')
      syncNavigationState()
    }

    const handleFailLoad = (event: Event) => {
      const failure = event as PreviewWebviewFailLoadEvent
      // 子框架失败（缺个图标、某个 chunk 404）不该把整页标成错误。
      if (!failure.isMainFrame) return
      // -3 ERR_ABORTED：用户主动 stop 或快速二次导航，不是真的失败。
      if (failure.errorCode === -3) return

      previewSessionService.markStatus(
        sessionId,
        'error',
        failure.errorDescription || `Failed to load ${failure.validatedURL}`,
        failure.errorCode,
      )
    }

    const handleNavigate = (event: Event) => {
      const navigation = event as PreviewWebviewNavigateEvent
      committedUrlRef.current = navigation.url
      previewSessionService.syncNavigated(sessionId, navigation.url)
      setAddressInput(navigation.url)
      setAddressError(null)
      syncNavigationState()
    }

    const handleTitle = (event: Event) => {
      const titleEvent = event as PreviewWebviewTitleEvent
      // explicitSet 为 false 时标题是 Chromium 从 URL 合成的，用它会让标签页
      // 显示成 "127.0.0.1:5173/src/app" 这种东西。
      if (titleEvent.explicitSet) {
        previewSessionService.updateTitle(sessionId, titleEvent.title)
      }
    }

    const handleFavicon = (event: Event) => {
      const faviconEvent = event as PreviewWebviewFaviconEvent
      previewSessionService.updateFavicon(sessionId, faviconEvent.favicons?.[0])
    }

    const handleDestroyed = () => {
      guestReadyRef.current = false
    }

    element.addEventListener('did-start-loading', handleStartLoading)
    element.addEventListener('did-stop-loading', handleStopLoading)
    element.addEventListener('dom-ready', handleDomReady)
    element.addEventListener('did-finish-load', handleFinishLoad)
    element.addEventListener('did-fail-load', handleFailLoad)
    element.addEventListener('did-navigate', handleNavigate)
    element.addEventListener('did-navigate-in-page', handleNavigate)
    element.addEventListener('page-title-updated', handleTitle)
    element.addEventListener('page-favicon-updated', handleFavicon)
    element.addEventListener('destroyed', handleDestroyed)
    element.addEventListener('render-process-gone', handleDestroyed)

    return () => {
      element.removeEventListener('did-start-loading', handleStartLoading)
      element.removeEventListener('did-stop-loading', handleStopLoading)
      element.removeEventListener('dom-ready', handleDomReady)
      element.removeEventListener('did-finish-load', handleFinishLoad)
      element.removeEventListener('did-fail-load', handleFailLoad)
      element.removeEventListener('did-navigate', handleNavigate)
      element.removeEventListener('did-navigate-in-page', handleNavigate)
      element.removeEventListener('page-title-updated', handleTitle)
      element.removeEventListener('page-favicon-updated', handleFavicon)
      element.removeEventListener('destroyed', handleDestroyed)
      element.removeEventListener('render-process-gone', handleDestroyed)
      guestReadyRef.current = false
    }
  }, [callGuest, sessionId, syncNavigationState])

  /** session.url 变了且不是 guest 自己跳过去的 —— 主动导航。 */
  useEffect(() => {
    if (!activeSession?.url || activeSession.url === committedUrlRef.current) return
    navigateGuest(activeSession.url)
  }, [navigateGuest, activeSession?.url])

  /** reloadToken 递增即一次显式刷新请求。 */
  const reloadToken = activeSession?.reloadToken ?? 0
  const lastReloadTokenRef = useRef(reloadToken)
  useEffect(() => {
    if (reloadToken === lastReloadTokenRef.current) return
    lastReloadTokenRef.current = reloadToken
    callGuest((element) => element.reloadIgnoringCache())
  }, [callGuest, reloadToken])

  const handleNavigateToInput = useCallback(() => {
    if (!sessionId) return

    const nextUrl = sanitizeUrl(addressInput)
    if (!nextUrl) return

    if (!isBrowserPreviewUrl(nextUrl)) {
      setAddressError(t('preview.tab.invalidUrl', language))
      return
    }

    setAddressError(null)
    devServerDiscoveryService.registerManualUrl(nextUrl, workspaceRoot)
    previewSessionService.navigate(sessionId, nextUrl)
  }, [addressInput, language, sessionId, workspaceRoot])

  const handleDiscover = useCallback(async () => {
    const roots = workspace?.roots
    if (!roots?.length) return

    await devServerDiscoveryService.refresh(roots, { force: true })
    const candidate = devServerDiscoveryService.getPreferredCandidate(workspaceRoot)
    if (!candidate) return

    if (sessionId) {
      previewSessionService.navigate(sessionId, candidate.url)
    } else {
      previewSessionService.openCandidate(candidate, { activate: true })
    }
  }, [sessionId, workspace?.roots, workspaceRoot])

  const handleCopyUrl = useCallback(async () => {
    if (!activeSession?.url) return
    await api.clipboard.writeText(activeSession.url)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }, [activeSession?.url])

  const handleChangeZoom = useCallback((next: number) => {
    const clamped = Math.min(Math.max(next, MIN_ZOOM_LEVEL), MAX_ZOOM_LEVEL)
    setZoomLevel(clamped)
    updatePreviewSettings({ zoomLevel: clamped })
    callGuest((element) => element.setZoomLevel(clamped))
  }, [callGuest])

  const handleToggleDevTools = useCallback(() => {
    callGuest((element) => {
      if (element.isDevToolsOpened()) {
        element.closeDevTools()
      } else {
        element.openDevTools()
      }
    })
  }, [callGuest])

  const isLoading = activeSession?.status === 'loading'
  const isConnectionError = activeSession?.status === 'error'
    && typeof activeSession.lastErrorCode === 'number'
    && CONNECTION_ERROR_CODES.has(activeSession.lastErrorCode)

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="h-11 border-b border-border/50 px-2 flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => callGuest((element) => element.goBack())}
          disabled={!activeSession?.canGoBack}
          title={t('preview.tab.back', language)}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => callGuest((element) => element.goForward())}
          disabled={!activeSession?.canGoForward}
          title={t('preview.tab.forward', language)}
        >
          <ArrowRight className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => {
            if (isLoading) {
              callGuest((element) => element.stop())
              if (sessionId) previewSessionService.markStatus(sessionId, 'ready')
              return
            }
            if (sessionId) previewSessionService.reload(sessionId)
          }}
          disabled={!sessionId}
          title={isLoading ? t('preview.tab.stop', language) : t('preview.tab.reload', language)}
        >
          {isLoading ? <X className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
        </Button>

        <div className={`flex-1 min-w-0 h-8 rounded-lg border bg-surface/40 flex items-center gap-2 px-2.5 ${
          addressError ? 'border-status-error/60' : 'border-border/50'
        }`}>
          {activeSession?.faviconUrl
            ? <img src={activeSession.faviconUrl} alt="" className="w-3.5 h-3.5 shrink-0 rounded-sm" />
            : <Globe className="w-3.5 h-3.5 text-text-muted shrink-0" />}
          <input
            value={addressInput}
            onChange={(event) => {
              setAddressInput(event.target.value)
              setAddressError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleNavigateToInput()
            }}
            className="flex-1 min-w-0 bg-transparent text-sm outline-none text-text-primary placeholder:text-text-muted"
            placeholder="http://127.0.0.1:5173"
            spellCheck={false}
            aria-label={t('preview.tab.open', language)}
            aria-invalid={addressError ? true : undefined}
          />
          <button
            onClick={() => void handleCopyUrl()}
            disabled={!activeSession?.url}
            className="shrink-0 rounded p-0.5 text-text-muted transition-colors hover:text-text-primary disabled:opacity-40"
            title={t('preview.tab.copyUrl', language)}
          >
            {copied ? <Check className="w-3.5 h-3.5 text-status-success" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>

        <Button variant="secondary" size="sm" onClick={handleNavigateToInput} disabled={!sessionId}>
          {t('preview.tab.open', language)}
        </Button>

        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => handleChangeZoom(zoomLevel - 1)}
            disabled={zoomLevel <= MIN_ZOOM_LEVEL}
            title={t('preview.tab.zoomOut', language)}
          >
            <ZoomOut className="w-4 h-4" />
          </Button>
          <button
            onClick={() => handleChangeZoom(0)}
            className="px-1 text-[10px] font-mono text-text-muted transition-colors hover:text-text-primary tabular-nums"
            title={t('preview.tab.zoomReset', language)}
          >
            {Math.round(1.2 ** zoomLevel * 100)}%
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => handleChangeZoom(zoomLevel + 1)}
            disabled={zoomLevel >= MAX_ZOOM_LEVEL}
            title={t('preview.tab.zoomIn', language)}
          >
            <ZoomIn className="w-4 h-4" />
          </Button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => void handleDiscover()}
          disabled={!workspace?.roots?.length}
          title={t('preview.tab.discover', language)}
        >
          <Search className={`w-4 h-4 ${discoveryState.scanning ? 'animate-pulse text-accent' : ''}`} />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleToggleDevTools}
          disabled={!activeSession}
          title={t('preview.tab.devtools', language)}
        >
          <Bug className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => activeSession?.url && void api.preview.openExternal(activeSession.url)}
          disabled={!activeSession?.url}
          title={t('preview.tab.openExternal', language)}
        >
          <ExternalLink className="w-4 h-4" />
        </Button>
      </div>

      {addressError && (
        <div className="px-3 py-1.5 border-b border-status-error/30 bg-status-error/10 text-[11px] text-status-error shrink-0">
          {addressError}
        </div>
      )}

      {scopedCandidates.length > 0 && (
        <div className="px-3 py-2 border-b border-border/40 flex items-center gap-2 overflow-x-auto scrollbar-none shrink-0">
          {scopedCandidates.map((candidate) => (
            <button
              key={candidate.id}
              onClick={() => sessionId && previewSessionService.navigate(sessionId, candidate.url)}
              disabled={!sessionId}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs whitespace-nowrap border transition-colors disabled:opacity-50 ${
                activeSession?.url?.startsWith(candidate.url)
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border/40 bg-surface/30 text-text-secondary hover:text-text-primary hover:bg-surface/50'
              }`}
              title={candidate.error || candidate.url}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                candidate.status === 'ready' ? 'bg-emerald-400'
                  : candidate.status === 'probing' ? 'bg-amber-400 animate-pulse'
                    : candidate.status === 'unreachable' ? 'bg-text-muted/50'
                      : 'bg-text-muted/30'
              }`} />
              {candidate.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 relative">
        {!mountRef.current.url ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 text-text-muted">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl border border-white/10 bg-surface/35">
              <OtterAsset asset="tool" className="h-14 w-14 object-contain opacity-90" />
            </div>
            <p className="text-sm font-medium text-text-primary">{t('preview.tab.emptyTitle', language)}</p>
            <p className="text-xs mt-2 max-w-md leading-relaxed">{t('preview.tab.emptyHint', language)}</p>
          </div>
        ) : (
          <>
            {/*
              key 绑到 sessionId：切换预览标签时必须换一个 guest，而同一会话内
              的地址变化走 loadURL —— 用 url 做 key 会让每次导航都重建整个 guest，
              导航历史随之清空。
            */}
            <webview
              {...PREVIEW_WEBVIEW_ATTRIBUTES}
              key={mountRef.current.sessionId || 'preview'}
              ref={webviewRef}
              src={mountRef.current.url}
              partition={PREVIEW_PARTITION}
              className="w-full h-full border-0 bg-white"
            />

            {isLoading && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none">
                <div className="px-3 py-1.5 rounded-full bg-background/90 border border-border/50 text-[11px] text-text-secondary flex items-center gap-2 shadow-lg">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  {t('preview.tab.loading', language)}
                </div>
              </div>
            )}

            {activeSession?.status === 'error' && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/95 px-6">
                <div className="max-w-md text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-status-error/10 text-status-error">
                    <X className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-medium text-text-primary">{t('preview.tab.errorTitle', language)}</p>
                  <p className="mt-2 text-xs text-text-secondary break-all">
                    {isConnectionError ? t('preview.tab.errorHintConnection', language) : activeSession.lastError || activeSession.url}
                  </p>
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => sessionId && previewSessionService.reload(sessionId)}
                      leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                    >
                      {t('preview.tab.retry', language)}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDiscover()}
                      disabled={!workspace?.roots?.length}
                      leftIcon={<Search className="w-3.5 h-3.5" />}
                    >
                      {t('preview.tab.discover', language)}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
