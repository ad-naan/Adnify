/**
 * 设置 IPC handlers
 */

import { logger } from '@shared/utils/Logger'
import { session } from 'electron'
import { ipcMain, BrowserWindow } from 'electron'
import * as fs from 'fs'
import Store from 'electron-store'
import { getBootstrapStore, getUserConfigDir, setUserConfigDir } from '../services/configPath'
import { cleanConfigValue } from '@shared/config/configCleaner'
import { normalizeSecuritySettings, SECURITY_SETTINGS_DEFAULTS } from '@shared/config/securitySettings'

interface SecurityModuleRef {
  securityManager: any
  updateWhitelist: (shell: string[], git: string[]) => void
}

const RECENT_LOG_MAX_BYTES = 1024 * 1024
const RECENT_LOG_MAX_LINES = 10000
const TAIL_CHUNK_SIZE = 64 * 1024

async function readRecentLogTail(filePath: string, maxBytes = RECENT_LOG_MAX_BYTES, maxLines = RECENT_LOG_MAX_LINES): Promise<string> {
  try {
    const stats = await fs.promises.stat(filePath)
    if (stats.size === 0) return ''

    const fileHandle = await fs.promises.open(filePath, 'r')
    try {
      const chunks: Buffer[] = []
      let position = stats.size
      let bytesCollected = 0
      let newlineCount = 0

      while (position > 0 && bytesCollected < maxBytes && newlineCount <= maxLines) {
        const readSize = Math.min(TAIL_CHUNK_SIZE, position, maxBytes - bytesCollected)
        position -= readSize
        const buffer = Buffer.alloc(readSize)
        const { bytesRead } = await fileHandle.read(buffer, 0, readSize, position)
        if (bytesRead <= 0) break

        const chunk = bytesRead === readSize ? buffer : buffer.subarray(0, bytesRead)
        chunks.unshift(chunk)
        bytesCollected += bytesRead
        newlineCount += chunk.toString('utf-8').split('\n').length - 1
      }

      const content = Buffer.concat(chunks).toString('utf-8')
      const lines = content.split(/\r?\n/)
      return lines.slice(-maxLines).join('\n')
    } finally {
      await fileHandle.close()
    }
  } catch {
    return ''
  }
}

export function applyProxy(proxySettings: any) {
  if (proxySettings && proxySettings.enabled && proxySettings.rules) {
    logger.ipc.info('[Proxy] Applying proxy rules:', proxySettings.rules)
    session.defaultSession.setProxy({
      proxyRules: proxySettings.rules,
      proxyBypassRules: proxySettings.bypassRules || '',
    }).catch(err => {
      logger.ipc.error('[Proxy] Failed to apply proxy:', err)
    })
    
    // Set environment variables for subprocesses (like git, language servers, terminal tools)
    process.env.HTTP_PROXY = proxySettings.rules
    process.env.HTTPS_PROXY = proxySettings.rules
    if (proxySettings.bypassRules) {
      process.env.NO_PROXY = proxySettings.bypassRules
    } else {
      delete process.env.NO_PROXY
    }
  } else {
    logger.ipc.info('[Proxy] Disabling proxy (direct connection)')
    session.defaultSession.setProxy({
      mode: 'direct',
    }).catch(err => {
      logger.ipc.error('[Proxy] Failed to disable proxy:', err)
    })
    
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    delete process.env.NO_PROXY
  }
}

let securityRef: SecurityModuleRef | null = null

export function registerSettingsHandlers(
  resolveStore: (key: string) => Store,
  preferencesStore: Store,
  _bootstrapStore: Store,
  securityModule?: SecurityModuleRef,
) {
  if (securityModule) {
    securityRef = securityModule
  }

  ipcMain.handle('settings:get', (_, key: string) => {
    try {
      const store = resolveStore(key)
      if (!store) {
        logger.ipc.error('[Settings] resolveStore returned null for key:', key)
        return undefined
      }
      return store.get(key)
    } catch (e) {
      logger.ipc.error('[Settings] settings:get failed', { key, error: e })
      throw e
    }
  })

  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
    try {
      const store = resolveStore(key)
      if (!store) {
        logger.ipc.error('[Settings] resolveStore returned null for key:', key)
        throw new Error(`Config store not ready for key: ${key}`)
      }
      const cleanedValue = cleanConfigValue(key, value)

      if (cleanedValue === undefined) {
        store.delete(key as any)
      } else {
        store.set(key, cleanedValue)
      }

      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('settings:changed', { key, value })
        }
      })

      if (key === 'securitySettings' && securityRef) {
        const securitySettings = normalizeSecuritySettings(cleanedValue ?? value)
        securityRef.securityManager.updateConfig(securitySettings)
        securityRef.updateWhitelist(
          securitySettings.allowedShellCommands,
          securitySettings.allowedGitSubcommands,
        )
      }

      if (key === 'app-settings') {
        const appSettings = (cleanedValue || value) as any
        if (appSettings && appSettings.proxySettings) {
          applyProxy(appSettings.proxySettings)
        }
      }

      return true
    } catch (e) {
      logger.ipc.error('[Settings] settings:set failed', { key, error: e })
      throw e
    }
  })

  ipcMain.handle('settings:resetWhitelist', () => {
    const defaultShellCommands = [...SECURITY_SETTINGS_DEFAULTS.allowedShellCommands]
    const defaultGitCommands = [...SECURITY_SETTINGS_DEFAULTS.allowedGitSubcommands]

    if (securityRef) {
      securityRef.updateWhitelist(defaultShellCommands, defaultGitCommands)
    }

    const currentSecuritySettings = preferencesStore.get('securitySettings', {}) as any
    const newSecuritySettings = {
      ...currentSecuritySettings,
      allowedShellCommands: defaultShellCommands,
      allowedGitSubcommands: defaultGitCommands,
    }
    preferencesStore.set('securitySettings', newSecuritySettings)

    return { shell: defaultShellCommands, git: defaultGitCommands }
  })

  ipcMain.handle('settings:getConfigPath', () => {
    return getUserConfigDir()
  })

  ipcMain.handle('settings:setConfigPath', async (_, newPath: string) => {
    try {
      if (!fs.existsSync(newPath)) {
        fs.mkdirSync(newPath, { recursive: true })
      }
      setUserConfigDir(newPath, getBootstrapStore())
      return true
    } catch (err) {
      logger.ipc.error('[Settings] Failed to set config path:', err)
      return false
    }
  })

  ipcMain.handle('workspace:restore:legacy', () => {
    const store = resolveStore('lastWorkspacePath')
    return store ? store.get('lastWorkspacePath') : undefined
  })

  ipcMain.handle('settings:getUserDataPath', () => {
    return getUserConfigDir()
  })

  ipcMain.handle('settings:getRecentLogs', async () => {
    try {
      const path = require('path')
      const logPath = path.join(getUserConfigDir(), 'logs', 'main.log')
      return await readRecentLogTail(logPath)
    } catch (err) {
      logger.ipc.error('[Settings] Failed to read logs:', err)
      return ''
    }
  })

  ipcMain.handle('cache:deepClean', async () => {
    try {
      await Promise.all([
        session.defaultSession.clearCache(),
        session.defaultSession.clearStorageData({
          storages: ['localstorage', 'shadercache', 'serviceworkers', 'cachestorage', 'indexdb', 'websql'],
        }),
      ])
      return { success: true }
    } catch (error) {
      logger.ipc.error('[Settings] Failed to deep clean cache:', error)
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
