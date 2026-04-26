import { lazy, Suspense, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useStore } from './store'
import { useWindowTitle, useAppInit, useGlobalShortcuts, useFileWatcher, useSidebarResize, useChatResize, useAppShutdownState, usePreviewDiscoveryToasts } from './hooks'
import TitleBar from './components/layout/TitleBar'
import ActivityBar from './components/layout/ActivityBar'
import StatusBar from './components/layout/StatusBar'
import { ToastProvider, useToast, setGlobalToast } from './components/common/ToastProvider'
import { GlobalConfirmDialog } from './components/common/ConfirmDialog'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { GlobalErrorHandler } from './components/common/GlobalErrorHandler'
import GlobalToastContainer from './components/common/GlobalToastContainer'
import { ThemeManager } from './components/editor/ThemeManager'
import { EditorSkeleton, PanelSkeleton, ChatSkeleton, FullScreenLoading, SettingsSkeleton } from './components/ui/Loading'
import { EmotionAmbientGlow } from './components/agent/EmotionAmbientGlow'
import { MascotIP } from './components/mascot/MascotIP'
import { startupMetrics } from '@shared/utils/startupMetrics'

startupMetrics.mark('app-module-loaded')

const Editor = lazy(() => import('./components/editor/Editor'))
const Sidebar = lazy(() => import('./components/sidebar/Sidebar'))
const ChatPanel = lazy(() => import('./components/agent/ChatPanel'))
const ShellStudio = lazy(() => import('./shell/components/ShellStudio'))

const TerminalPanel = lazy(() => import('./components/panels/TerminalPanel'))
const DebugPanel = lazy(() => import('./components/panels/DebugPanel'))
const ComposerPanel = lazy(() => import('./components/panels/ComposerPanel'))

const OnboardingWizard = lazy(() => import('./components/dialogs/OnboardingWizard'))
const SettingsModal = lazy(() => import('./components/settings/SettingsModal'))
const CommandPalette = lazy(() => import('./components/dialogs/CommandPalette'))
const KeyboardShortcuts = lazy(() => import('./components/dialogs/KeyboardShortcuts'))
const QuickOpen = lazy(() => import('./components/dialogs/QuickOpen'))
const AboutDialog = lazy(() => import('./components/dialogs/AboutDialog'))
const WelcomePage = lazy(() => import('./components/welcome/WelcomePage'))

function ToastInitializer() {
  const toastContext = useToast()

  useEffect(() => {
    setGlobalToast(toastContext)
  }, [toastContext])

  return null
}

function AppContent() {
  useAppShutdownState()

  const workspace = useStore((state) => state.workspace)
  const showSettings = useStore((state) => state.showSettings)
  const activeSidePanel = useStore((state) => state.activeSidePanel)
  const showComposer = useStore((state) => state.showComposer)
  const setShowComposer = useStore((state) => state.setShowComposer)
  const sidebarWidth = useStore((state) => state.sidebarWidth)
  const setSidebarWidth = useStore((state) => state.setSidebarWidth)
  const chatWidth = useStore((state) => state.chatWidth)
  const setChatWidth = useStore((state) => state.setChatWidth)
  const showQuickOpen = useStore((state) => state.showQuickOpen)
  const setShowQuickOpen = useStore((state) => state.setShowQuickOpen)
  const showAbout = useStore((state) => state.showAbout)
  const setShowAbout = useStore((state) => state.setShowAbout)
  const showCommandPalette = useStore((state) => state.showCommandPalette)
  const setShowCommandPalette = useStore((state) => state.setShowCommandPalette)
  const terminalVisible = useStore((state) => state.terminalVisible)
  const debugVisible = useStore((state) => state.debugVisible)
  const chatVisible = useStore((state) => state.chatVisible)

  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)

  useEffect(() => {
    window.__ADNIFY_STORE__ = { getState: () => useStore.getState() }
  }, [])

  const hasWorkspace = useMemo(() => Boolean(workspace && workspace.roots.length > 0), [workspace])
  const isShellStudioActive = activeSidePanel === 'shell'

  useWindowTitle()
  useFileWatcher()
  useGlobalShortcuts()
  usePreviewDiscoveryToasts(hasWorkspace && isInitialized)

  useAppInit({
    onInitialized: (result) => {
      setIsInitialized(true)
      if (result.shouldShowOnboarding) {
        setShowOnboarding(true)
      }
    },
  })

  const sidebarRef = useRef<HTMLDivElement>(null)
  const chatRef = useRef<HTMLDivElement>(null)

  const { startResize: startSidebarResize } = useSidebarResize(setSidebarWidth, sidebarRef)
  const { startResize: startChatResize } = useChatResize(setChatWidth, chatRef)

  const handleCloseKeyboardShortcuts = useCallback(() => setShowKeyboardShortcuts(false), [])
  const handleCloseOnboarding = useCallback(() => setShowOnboarding(false), [])

  return (
    <div className="h-screen flex flex-col bg-transparent overflow-hidden text-text-primary selection:bg-accent/30 selection:text-white relative">
      <div className="relative z-10 flex flex-col h-full">
        <TitleBar />

        {hasWorkspace ? (
          <>
            <div className="flex-1 flex overflow-hidden">
              <ActivityBar />

              {activeSidePanel && !isShellStudioActive && (
                <div ref={sidebarRef} style={{ width: sidebarWidth, minWidth: sidebarWidth }} className="flex-shrink-0 relative min-w-[220px]">
                  <Suspense fallback={<PanelSkeleton />}>
                    <Sidebar />
                  </Suspense>
                  <div
                    className="absolute top-0 right-0 w-1 h-full cursor-col-resize active:bg-accent transition-colors z-50 translate-x-[2px]"
                    onMouseDown={startSidebarResize}
                  />
                </div>
              )}

              <div className="flex-1 flex min-w-0 bg-background relative">
                <EmotionAmbientGlow />

                <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                  {isShellStudioActive ? (
                    <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
                      <ErrorBoundary>
                        <Suspense fallback={<EditorSkeleton />}>
                          <ShellStudio />
                        </Suspense>
                      </ErrorBoundary>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
                        <ErrorBoundary>
                          <Suspense fallback={<EditorSkeleton />}>
                            <Editor />
                          </Suspense>
                        </ErrorBoundary>
                      </div>
                      {terminalVisible && (
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <TerminalPanel />
                          </Suspense>
                        </ErrorBoundary>
                      )}
                      {debugVisible && (
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <DebugPanel />
                          </Suspense>
                        </ErrorBoundary>
                      )}
                    </>
                  )}
                </div>

                {chatVisible && (
                  <div ref={chatRef} style={{ width: chatWidth }} className="flex-shrink-0 relative border-l border-border/30 shadow-[-1px_0_15px_rgba(0,0,0,0.03)] z-20 bg-background">
                    <div
                      className="absolute top-0 left-0 w-1 h-full cursor-col-resize active:bg-accent transition-colors z-50 -translate-x-[2px]"
                      onMouseDown={startChatResize}
                    />
                    <ErrorBoundary>
                      <Suspense fallback={<ChatSkeleton />}>
                        <ChatPanel />
                      </Suspense>
                    </ErrorBoundary>
                  </div>
                )}
              </div>
            </div>

            <StatusBar />
          </>
        ) : (
          <div className="flex-1 overflow-hidden">
            <Suspense fallback={<FullScreenLoading />}>
              <WelcomePage />
            </Suspense>
          </div>
        )}
      </div>

      {showSettings && (
        <Suspense fallback={<SettingsSkeleton />}>
          <SettingsModal />
        </Suspense>
      )}
      {showCommandPalette && (
        <Suspense fallback={null}>
          <CommandPalette
            onClose={() => setShowCommandPalette(false)}
            onShowKeyboardShortcuts={() => {
              setShowCommandPalette(false)
              setShowKeyboardShortcuts(true)
            }}
          />
        </Suspense>
      )}
      {showKeyboardShortcuts && (
        <Suspense fallback={null}>
          <KeyboardShortcuts onClose={handleCloseKeyboardShortcuts} />
        </Suspense>
      )}
      {showQuickOpen && (
        <Suspense fallback={null}>
          <QuickOpen onClose={() => setShowQuickOpen(false)} />
        </Suspense>
      )}
      {showComposer && (
        <Suspense fallback={null}>
          <ComposerPanel onClose={() => setShowComposer(false)} />
        </Suspense>
      )}
      {showOnboarding && isInitialized && (
        <Suspense fallback={null}>
          <OnboardingWizard onComplete={handleCloseOnboarding} />
        </Suspense>
      )}
      {showAbout && (
        <Suspense fallback={null}>
          <AboutDialog onClose={() => setShowAbout(false)} />
        </Suspense>
      )}

      <GlobalConfirmDialog />
      <GlobalToastContainer />
      <MascotIP />
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <ToastInitializer />
      <GlobalErrorHandler>
        <ThemeManager>
          <AppContent />
        </ThemeManager>
      </GlobalErrorHandler>
    </ToastProvider>
  )
}
