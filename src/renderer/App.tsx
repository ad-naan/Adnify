import { lazy, Suspense, useState, useCallback, useEffect, useMemo } from 'react'
import { useStore } from './store'
import { useWindowTitle, useAppInit, useOpenFilesFromSystem, useGlobalShortcuts, useFileWatcher, useAppShutdownState, usePreviewDiscovery, useVersionNotice } from './hooks'
import TitleBar from './components/layout/TitleBar'
import ActivityBar from './components/layout/ActivityBar'
import StatusBar from './components/layout/StatusBar'
import { ToastProvider, useToast, setGlobalToast } from './components/common/ToastProvider'
import { GlobalConfirmDialog } from './components/common/ConfirmDialog'
import { GlobalErrorHandler } from './components/common/GlobalErrorHandler'
import GlobalToastContainer from './components/common/GlobalToastContainer'
import { ThemeManager } from './components/editor/ThemeManager'
import { FullScreenLoading, SettingsSkeleton } from './components/ui/Loading'
import WorkspaceWorkbench from './components/layout/WorkspaceWorkbench'
import { startupMetrics } from '@shared/utils/startupMetrics'
import SystemPrivilegeCoordinator from './components/system/SystemPrivilegeCoordinator'
import { useBackgroundTasks } from './backgroundTasks/useBackgroundTasks'
import { useNotificationBridge } from './notifications/useNotificationBridge'
import { DecorativeAnimationScope } from './components/common/DecorativeAnimationScope'

startupMetrics.mark('app-module-loaded')

const OnboardingWizard = lazy(() => import('./components/dialogs/OnboardingWizard'))
const SettingsModal = lazy(() => import('./components/settings/SettingsModal'))
const CommandPalette = lazy(() => import('./components/dialogs/CommandPalette'))
const KeyboardShortcuts = lazy(() => import('./components/dialogs/KeyboardShortcuts'))
const QuickOpen = lazy(() => import('./components/dialogs/QuickOpen'))
const AboutDialog = lazy(() => import('./components/dialogs/AboutDialog'))
const ChangelogDialog = lazy(() => import('./components/dialogs/ChangelogDialog'))
const UserAvatarDialog = lazy(() => import('./components/dialogs/UserAvatarDialog'))
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
  const showQuickOpen = useStore((state) => state.showQuickOpen)
  const setShowQuickOpen = useStore((state) => state.setShowQuickOpen)
  const showAbout = useStore((state) => state.showAbout)
  const setShowAbout = useStore((state) => state.setShowAbout)
  const showChangelog = useStore((state) => state.showChangelog)
  const setShowChangelog = useStore((state) => state.setShowChangelog)
  const selectedChangelogVersion = useStore((state) => state.selectedChangelogVersion)
  const showAvatarDialog = useStore((state) => state.showAvatarDialog)
  const showCommandPalette = useStore((state) => state.showCommandPalette)
  const setShowCommandPalette = useStore((state) => state.setShowCommandPalette)
  const editorConfig = useStore((state) => state.editorConfig)

  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)

  useEffect(() => {
    window.__ADNIFY_STORE__ = { getState: () => useStore.getState() }
  }, [])

  const hasWorkspace = useMemo(() => Boolean(workspace && workspace.roots.length > 0), [workspace])
  const layoutDensityClass = editorConfig.layoutDensity === 'compact'
    ? 'layout-density-compact'
    : editorConfig.layoutDensity === 'expanded'
      ? 'layout-density-expanded'
      : 'layout-density-comfortable'

  useWindowTitle()
  useFileWatcher()
  useOpenFilesFromSystem()
  useGlobalShortcuts()
  usePreviewDiscovery(hasWorkspace && isInitialized)
  useVersionNotice(isInitialized)
  useBackgroundTasks(isInitialized)
  useNotificationBridge(isInitialized)

  useAppInit({
    onInitialized: (result) => {
      setIsInitialized(true)
      if (result.shouldShowOnboarding) {
        setShowOnboarding(true)
      }
    },
  })

  const handleCloseKeyboardShortcuts = useCallback(() => setShowKeyboardShortcuts(false), [])
  const handleCloseOnboarding = useCallback(() => setShowOnboarding(false), [])

  return (
    <DecorativeAnimationScope className={`h-screen flex flex-col bg-transparent overflow-hidden text-text-primary selection:bg-accent/30 selection:text-white relative ${layoutDensityClass}`}>
      <DecorativeAnimationScope
        paused={showSettings || showAbout || showChangelog || showAvatarDialog || showKeyboardShortcuts || showOnboarding || showCommandPalette || showQuickOpen}
        className="relative z-10 flex flex-col h-full"
      >
        <TitleBar />

        {hasWorkspace ? (
          <>
            <div className="flex-1 flex overflow-hidden">
              <ActivityBar />

              <WorkspaceWorkbench />
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
      </DecorativeAnimationScope>

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
      {showChangelog && (
        <Suspense fallback={null}>
          <ChangelogDialog
            onClose={() => setShowChangelog(false)}
            initialVersion={selectedChangelogVersion}
          />
        </Suspense>
      )}
      {showAvatarDialog && (
        <Suspense fallback={null}>
          <UserAvatarDialog />
        </Suspense>
      )}

      <GlobalConfirmDialog />
      <GlobalToastContainer />
    </DecorativeAnimationScope>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <ToastInitializer />
      <SystemPrivilegeCoordinator />
      <GlobalErrorHandler>
        <ThemeManager>
          <AppContent />
        </ThemeManager>
      </GlobalErrorHandler>
    </ToastProvider>
  )
}
