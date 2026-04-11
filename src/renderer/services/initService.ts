/**
 * App initialization service.
 * Keeps startup sequencing out of App.tsx so we can optimize the boot path safely.
 */

import { api } from './electronAPI'
import { logger } from '@utils/Logger'
import { startupMetrics } from '@shared/utils/startupMetrics'
import { useStore } from '../store'
import { initializeAgentStore } from '@renderer/agent/store/AgentStore'
import { themeManager } from '../config/themeConfig'
import { keybindingService } from './keybindingService'
import { registerCoreCommands } from '../config/commands'
import { adnifyDir } from './adnifyDirService'
import { initDiagnosticsListener } from './diagnosticsStore'
import { restoreWorkspaceState } from './workspaceStateService'
import { restoreWorkspaceAgentData } from './workspaceAgentRestoreService'
import { mcpService } from './mcpService'
import { snippetService } from './snippetService'
import { workerService } from './workerService'
import {
  commitWorkspaceShell,
  prepareWorkspaceShell,
} from './workspaceLoadService'

export interface InitResult {
  success: boolean
  shouldShowOnboarding: boolean
  error?: string
}

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

  registerCoreCommands()

  await Promise.all([
    keybindingService.init(),
    initializeAgentStore(),
    themeManager.init(),
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
      toast.warning('上次打开的工作区已不存在，请重新选择文件夹', missing || undefined)
    }

    startupMetrics.end('restore-workspace')
    return false
  }

  await Promise.all(workspaceConfig.roots.map(root => adnifyDir.initialize(root)))
  const shellState = await prepareWorkspaceShell(workspaceConfig)
  await commitWorkspaceShell(shellState)

  schedulePostPaintTask(() => {
    try {
      initDiagnosticsListener()
    } catch (e) {
      logger.system.warn('[Init] Diagnostics listener init failed:', e)
    }
  }, 16)

  await Promise.all([
    restoreWorkspaceState(),
    restoreWorkspaceAgentData(),
  ])

  scheduleIdleTask(() => mcpService.initialize(workspaceConfig.roots), 1000)

  startupMetrics.end('restore-workspace')
  return true
}

function scheduleBackgroundInit(): void {
  scheduleIdleTask(() => {
    try {
      workerService.init()
      logger.system.debug('[Init] Worker service initialized')
    } catch (e) {
      logger.system.warn('[Init] Worker service init failed:', e)
    }
  })
}

export async function initializeApp(
  updateStatus: (status: string) => void
): Promise<InitResult> {
  try {
    startupMetrics.start('init-total')

    updateStatus('Initializing...')
    await initCoreModules()

    updateStatus('Loading settings...')
    const params = new URLSearchParams(window.location.search)
    const isEmptyWindow = params.get('empty') === '1'
    const savedTheme = await loadUserSettings(isEmptyWindow)

    if (savedTheme && isThemeName(savedTheme)) {
      useStore.getState().setTheme(savedTheme)
    }

    const { onboardingCompleted, hasExistingConfig } = useStore.getState()

    if (!isEmptyWindow) {
      updateStatus('Restoring workspace...')
      await restoreWorkspace()
    }

    scheduleBackgroundInit()

    updateStatus('Ready!')
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
    const { globalConfirm } = await import('@components/common/ConfirmDialog')
    await globalConfirm({
      title: error.title,
      message: error.message,
      variant: (error.variant as 'danger' | 'warning' | 'info') || 'danger',
      confirmText: 'OK',
    })
  })
}
