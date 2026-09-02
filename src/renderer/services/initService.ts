/**
 * App initialization service.
 * Keeps startup sequencing out of App.tsx so we can optimize the boot path safely.
 */

import { api } from './electronAPI'
import { logger } from '@utils/Logger'
import { startupMetrics } from '@shared/utils/startupMetrics'
import { globalConfirm } from '@components/common/ConfirmDialog'
import { useStore } from '../store'
import { initializeAgentStore } from '@renderer/agent/store/AgentStore'
import { themeManager } from '../config/themeConfig'
import { keybindingService } from './keybindingService'
import { registerCoreCommands } from '../config/commands'
import { initDiagnosticsListener } from './diagnosticsStore'
import { restoreWorkspaceState } from './workspaceStateService'
import { mcpService } from './mcpService'
import { snippetService } from './snippetService'
import { workspaceStorageRuntime } from './workspaceStorageRuntime'
import { initCacheLifecycleService } from './cacheLifecycleService'
import { runWithAgentStorageWritesSuspended } from '@renderer/agent/store/agentStorage'
import {
  bindWorkspaceRoot,
  commitWorkspaceShell,
  prepareWorkspaceShell,
  restoreWorkspaceAgentStore,
} from './workspaceLoadService'
import { workspaceAnalyticsService } from './workspaceAnalyticsService'
import { t } from '@shared/i18n'

export interface InitResult {
  success: boolean
  shouldShowOnboarding: boolean
  error?: string
}

/**
 * 启动阶段。
 *
 * 报的是阶段码而不是句子：闪屏文案要按 `language` 翻译，而这里既不知道用户的语言
 * （第一个阶段跑在设置加载之前），也不该在服务层拼界面文字。旧代码报英文句子、
 * 由 `useAppInit` 逐句 if 比较再换成中文，加一个阶段就要改两处字符串。
 */
export type AppInitPhase = 'initializing' | 'settings' | 'workspace' | 'ready'

function scheduleIdleTask(task: () => void | Promise<void>, timeout = 2000): void {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => { task() }, { timeout })
  } else {
    setTimeout(task, 100)
  }
}

function schedulePostPaintTask(task: () => void, delay = 0): void {
  requestAnimationFrame(() => {
    if (delay > 0) {
      setTimeout(task, delay)
      return
    }

    task()
  })
}

async function initCoreModules(): Promise<void> {
  startupMetrics.start('init-core')

  initCacheLifecycleService()
  registerCoreCommands()

  await Promise.all([
    keybindingService.init(),
    initializeAgentStore(),
    themeManager.loadFromConfig(),
    snippetService.init(),
  ])

  startupMetrics.end('init-core')
}

async function loadUserSettings(_isEmptyWindow: boolean): Promise<string | null> {
  startupMetrics.start('load-settings')

  const [, savedTheme] = await Promise.all([
    useStore.getState().load(),
    api.settings.get('themeId'),
  ])

  const { webSearchConfig, mcpConfig } = useStore.getState()
  if (webSearchConfig?.googleApiKey && webSearchConfig?.googleCx) {
    api.http.setGoogleSearch(webSearchConfig.googleApiKey, webSearchConfig.googleCx).catch((e) => {
      logger.system.warn('[Init] Failed to set Google Search config:', e)
    })
  }

  if (mcpConfig?.autoConnect !== undefined) {
    api.mcp.setAutoConnect(mcpConfig.autoConnect).catch((e) => {
      logger.system.warn('[Init] Failed to set MCP auto-connect config:', e)
    })
  }

  const { editorConfig } = useStore.getState()
  const persistedZoomFactor = typeof editorConfig?.uiScale === 'number'
    ? Math.min(3, Math.max(0.5, editorConfig.uiScale))
    : 1

  try {
    const appliedZoomFactor = await api.window.setZoomFactor(persistedZoomFactor)
    if (Math.abs(appliedZoomFactor - persistedZoomFactor) > 0.001) {
      useStore.getState().set('editorConfig', {
        ...editorConfig,
        uiScale: appliedZoomFactor,
      })
    }
  } catch (error) {
    logger.system.warn('[Init] Failed to restore window zoom factor:', error)
  }

  startupMetrics.end('load-settings')
  return savedTheme as string | null
}

async function restoreWorkspace(): Promise<boolean> {
  startupMetrics.start('restore-workspace')

  const workspaceConfig = await api.workspace.restore()
  if (!workspaceConfig?.roots?.length) {
    if (workspaceConfig?.restoreError === 'missing-workspace') {
      const missing = workspaceConfig.missingRoots?.[0] || ''
      const { toast } = await import('@renderer/components/common/ToastProvider')
      // `loadUserSettings()`（内含 store.load()）在 `initializeApp` 里先于本函数 await，
      // 所以这里读到的已经是持久化的语言，不是默认值。
      toast.warning(
        t('initService.lastWorkspaceMissing', useStore.getState().language),
        missing || undefined,
      )
    }

    startupMetrics.end('restore-workspace')
    return false
  }

  await workspaceStorageRuntime.initializeRoots(workspaceConfig.roots)
  const shellState = await prepareWorkspaceShell(workspaceConfig)
    await runWithAgentStorageWritesSuspended(async () => {
      await bindWorkspaceRoot(shellState)

      await Promise.all([
        restoreWorkspaceState(),
        restoreWorkspaceAgentStore(),
      ])
    })

  commitWorkspaceShell(shellState)
  await workspaceAnalyticsService.bindWorkspace(workspaceConfig)

  schedulePostPaintTask(() => {
    try {
      initDiagnosticsListener()
    } catch (e) {
      logger.system.warn('[Init] Diagnostics listener init failed:', e)
    }
  }, 16)

  scheduleIdleTask(() => mcpService.initialize(workspaceConfig.roots), 1000)

  startupMetrics.end('restore-workspace')
  return true
}

export async function initializeApp(
  updateStatus: (phase: AppInitPhase) => void
): Promise<InitResult> {
  try {
    startupMetrics.start('init-total')

    updateStatus('initializing')
    await initCoreModules()

    updateStatus('settings')
    const params = new URLSearchParams(window.location.search)
    const isEmptyWindow = params.get('empty') === '1'
    const savedTheme = await loadUserSettings(isEmptyWindow)

    if (savedTheme && isThemeName(savedTheme)) {
      useStore.getState().setTheme(savedTheme)
    }

    const { onboardingCompleted, hasExistingConfig } = useStore.getState()

    if (!isEmptyWindow) {
      updateStatus('workspace')
      await restoreWorkspace()
    }

    updateStatus('ready')
    startupMetrics.end('init-total')

    if (import.meta.env.DEV) {
      startupMetrics.mark('app-ready')
      startupMetrics.printReport()
    }

    const shouldShowOnboarding = onboardingCompleted === false ||
      (onboardingCompleted === undefined && !hasExistingConfig)

    return { success: true, shouldShowOnboarding }
  } catch (error) {
    logger.system.error('[Init] Failed to initialize app:', error)
    registerCoreCommands()

    return {
      success: false,
      shouldShowOnboarding: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function registerSettingsSync(): () => void {
  const store = useStore.getState()

  return api.settings.onChanged(({ key, value }: { key: string; value: unknown }) => {
    logger.system.debug(`[Init] Setting changed: ${key}`)

    switch (key) {
      case 'llmConfig':
        if (isLLMConfig(value)) {
          store.update('llmConfig', value)
        }
        break
      case 'language':
        if (value === 'en' || value === 'zh') {
          store.set('language', value)
        }
        break
      case 'autoApprove':
        if (isAutoApproveSettings(value)) {
          store.update('autoApprove', value)
        }
        break
      case 'promptTemplateId':
        if (typeof value === 'string') {
          store.set('promptTemplateId', value)
        }
        break
      case 'themeId':
        if (isThemeName(value)) {
          store.setTheme(value)
        }
        break
      case 'enableFileLogging':
        if (typeof value === 'boolean') {
          store.set('enableFileLogging', value)
        }
        break
    }
  })
}

function isLLMConfig(value: unknown): value is Partial<import('@store').LLMConfig> {
  return typeof value === 'object' && value !== null
}

function isAutoApproveSettings(value: unknown): value is Partial<import('@store').AutoApproveSettings> {
  return typeof value === 'object' && value !== null
}

function isThemeName(value: unknown): value is import('@store').ThemeName {
  const validThemes = ['adnify-dark', 'midnight', 'cyberpunk', 'dawn']
  return typeof value === 'string' && validThemes.includes(value)
}

export function registerAppErrorListener(): () => void {
  return api.app.onError(async (error) => {
    await globalConfirm({
      title: error.title,
      message: error.message,
      variant: (error.variant as 'danger' | 'warning' | 'info') || 'danger',
      confirmText: 'OK',
    })
  })
}
