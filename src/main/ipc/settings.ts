/**
 * 设置 IPC handlers
 */

import { logger } from '@shared/utils/Logger'
import { ipcMain, BrowserWindow } from 'electron'
import * as fs from 'fs'
import Store from 'electron-store'
import { getUserConfigDir, setUserConfigDir } from '../services/configPath'
import { cleanConfigValue } from '@shared/config/configCleaner'
import { SECURITY_DEFAULTS } from '@shared/constants'

interface SecurityModuleRef {
  securityManager: any
  updateWhitelist: (shell: string[], git: string[]) => void
  getWhitelist: () => { shell: string[]; git: string[] }
}

const RECENT_LOG_MAX_BYTES = 1024 * 1024
const RECENT_LOG_MAX_LINES = 10000
const TAIL_CHUNK_SIZE = 64 * 1024

function readRecentLogTail(filePath: string, maxBytes = RECENT_LOG_MAX_BYTES, maxLines = RECENT_LOG_MAX_LINES): string {
  if (!fs.existsSync(filePath)) return ''

  const stats = fs.statSync(filePath)
  if (stats.size === 0) return ''

  const fileHandle = fs.openSync(filePath, 'r')
  try {
    const chunks: Buffer[] = []
    let position = stats.size
    let bytesCollected = 0
    let newlineCount = 0

    while (position > 0 && bytesCollected < maxBytes && newlineCount <= maxLines) {
      const readSize = Math.min(TAIL_CHUNK_SIZE, position, maxBytes - bytesCollected)
      position -= readSize
      const buffer = Buffer.alloc(readSize)
      const bytesRead = fs.readSync(fileHandle, buffer, 0, readSize, position)
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
    fs.closeSync(fileHandle)
  }
}

let securityRef: SecurityModuleRef | null = null

export function registerSettingsHandlers(
  resolveStore: (key: string) => Store,
  preferencesStore: Store,
  _bootstrapStore: Store,
  securityModule?: SecurityModuleRef
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
        const securitySettings = (cleanedValue ?? value) as any
        const defaults = {
          enablePermissionConfirm: true,
          strictWorkspaceMode: true,
          allowedShellCommands: SECURITY_DEFAULTS.SHELL_COMMANDS,
          allowedGitSubcommands: SECURITY_DEFAULTS.GIT_SUBCOMMANDS,
        }
        securityRef.securityManager.updateConfig(securitySettings ?? defaults)

        const shellCommands =
          securitySettings?.allowedShellCommands != null
            ? securitySettings.allowedShellCommands
            : SECURITY_DEFAULTS.SHELL_COMMANDS
        const gitCommands =
          securitySettings?.allowedGitSubcommands != null
            ? securitySettings.allowedGitSubcommands
            : SECURITY_DEFAULTS.GIT_SUBCOMMANDS
        securityRef.updateWhitelist(shellCommands, gitCommands)
      }

      return true
    } catch (e) {
      logger.ipc.error('[Settings] settings:set failed', { key, error: e })
      throw e
    }
  })

  ipcMain.handle('settings:getWhitelist', () => {
    if (!securityRef) {
      return { shell: [], git: [] }
    }
    return securityRef.getWhitelist()
  })

  ipcMain.handle('settings:resetWhitelist', () => {
    const defaultShellCommands = [...SECURITY_DEFAULTS.SHELL_COMMANDS]
    const defaultGitCommands = [...SECURITY_DEFAULTS.GIT_SUBCOMMANDS]

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
      setUserConfigDir(newPath)
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
      return readRecentLogTail(logPath)
    } catch (err) {
      logger.ipc.error('[Settings] Failed to read logs:', err)
      return ''
    }
  })
}
