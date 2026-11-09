import { app, BrowserWindow } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { logger } from '@shared/utils/Logger'
import { toAppError } from '@shared/utils/errorHandler'
import * as fs from 'fs'
import * as path from 'path'
import { mainEditorEvents } from '../notifications/events'
import { CNB_RELEASES_URL, cnbReleaseFeed, fetchLatestCnbRelease } from './cnbRelease'

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  releaseNotes?: string
  releaseDate?: string
  downloadUrl?: string
  progress?: number
  /**
   * Diagnostic detail, always English — the UI renders its own translated
   * "update failed" copy and only logs this. Do not put user-facing sentences
   * here: this service runs in the main process and never sees `language`.
   */
  error?: string
  requiresManualDownload: boolean
  isPortable: boolean
}

class UpdateService {
  private status: UpdateStatus = {
    status: 'idle',
    requiresManualDownload: false,
    isPortable: false,
  }

  private mainWindow: BrowserWindow | null = null
  private updateCheckInterval: NodeJS.Timeout | null = null
  private startupCheck: NodeJS.Timeout | null = null
  private checkInProgress: Promise<UpdateStatus> | null = null

  initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    const requiresManualDownload = !app.isPackaged || this.detectManualDownloadMode()
    this.status.requiresManualDownload = requiresManualDownload
    this.status.isPortable = requiresManualDownload

    if (!requiresManualDownload) this.setupAutoUpdater()
    this.startupCheck = setTimeout(() => void this.checkForUpdates(), 30_000)
    this.updateCheckInterval = setInterval(() => void this.checkForUpdates(), 4 * 60 * 60 * 1000)
  }

  /**
   * Detect package layouts that should not use electron-updater directly.
   */
  private detectManualDownloadMode(): boolean {
    const exePath = app.getPath('exe')
    const exeDir = path.dirname(exePath)

    if (process.platform === 'win32') {
      // Windows releases are installer-based now. If the usual uninstall entry
      // is missing, treat it as a non-standard layout and avoid auto-install.
      const uninstallPath = path.join(exeDir, 'Uninstall Adnify.exe')
      return !fs.existsSync(uninstallPath)
    }

    if (process.platform === 'darwin') {
      // Drag-and-drop app bundles outside /Applications are often ad-hoc copies.
      return !exePath.startsWith('/Applications/')
    }

    if (process.platform === 'linux') {
      // AppImage is the supported Linux update path.
      return !process.env.APPIMAGE
    }

    return true
  }

  private setupAutoUpdater(): void {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.channel = process.arch === 'arm64' && process.platform !== 'linux' ? 'latest-arm64' : 'latest'
    // Setting the channel enables downgrades in electron-updater.
    autoUpdater.allowDowngrade = false

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.updateStatus({ status: 'downloading', progress: Math.round(progress.percent) })
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.updateStatus({ status: 'downloaded', version: info.version })
    })

    autoUpdater.on('error', (err: Error) => {
      logger.system.error('[Updater] Electron updater error:', err)
      // Squirrel can reject the app after the ZIP has already been downloaded.
      if (process.platform === 'darwin' && this.status.status === 'downloaded') {
        this.updateStatus({ status: 'available', requiresManualDownload: true, progress: undefined })
      }
    })
  }

  checkForUpdates(): Promise<UpdateStatus> {
    if (this.status.status === 'downloading' || this.status.status === 'downloaded') {
      return Promise.resolve(this.getStatus())
    }
    this.checkInProgress ??= this.checkCnbRelease().finally(() => { this.checkInProgress = null })
    return this.checkInProgress
  }

  private async checkCnbRelease(): Promise<UpdateStatus> {
    this.updateStatus({
      status: 'checking',
      error: undefined,
      version: undefined,
      releaseNotes: undefined,
      releaseDate: undefined,
      downloadUrl: undefined,
      requiresManualDownload: this.status.isPortable,
    })

    try {
      const release = await fetchLatestCnbRelease()
      const version = release?.tag_name.slice(1)
      if (!release || !version || !this.isNewerVersion(version, app.getVersion())) {
        this.updateStatus({ status: 'not-available' })
        return this.getStatus()
      }

      const feed = cnbReleaseFeed(release.tag_name)
      const downloadUrl = this.findDownloadUrl(release.assets ?? [], feed)
      let requiresManualDownload = this.status.isPortable
      if (!requiresManualDownload) {
        try {
          autoUpdater.setFeedURL({ provider: 'generic', url: feed, useMultipleRangeRequest: false })
          const result = await autoUpdater.checkForUpdates()
          if (result?.updateInfo.version === version && !result.isUpdateAvailable) {
            this.updateStatus({ status: 'not-available' })
            return this.getStatus()
          }
          requiresManualDownload = result?.updateInfo.version !== version
        } catch (err) {
          logger.system.warn('[Updater] CNB update metadata unavailable:', err)
          requiresManualDownload = true
        }
      }

      this.updateStatus({
        status: 'available',
        version,
        releaseNotes: release.body,
        releaseDate: release.published_at,
        downloadUrl,
        requiresManualDownload,
      })
    } catch (err) {
      const error = toAppError(err)
      logger.system.warn('[Updater] CNB release check failed:', error.message)
      this.updateStatus({ status: 'error', error: error.message || 'Update check failed' })
    }

    return this.getStatus()
  }

  async downloadUpdate(): Promise<void> {
    if (this.status.requiresManualDownload) {
      throw new Error('In-app download is not supported by this installation; use the download page instead')
    }
    if (this.status.status !== 'available') throw new Error('No update available')

    this.updateStatus({ status: 'downloading', progress: 0 })
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      logger.system.warn('[Updater] CNB update download failed:', error)
      this.updateStatus({ status: 'available', requiresManualDownload: true, progress: undefined })
    }
  }

  quitAndInstall(): void {
    if (this.status.requiresManualDownload) {
      throw new Error('In-app install is not supported by this installation; use the download page instead')
    }

    if (this.status.status !== 'downloaded') {
      throw new Error('Update not downloaded')
    }

    autoUpdater.autoInstallOnAppQuit = true
    logger.system.info('[Updater] Initiating quit and install...')

    setTimeout(() => {
      logger.system.info('[Updater] Calling autoUpdater.quitAndInstall(true, true)')
      autoUpdater.quitAndInstall(true, true)
    }, 100)
  }

  getStatus(): UpdateStatus {
    return { ...this.status }
  }

  destroy(): void {
    if (this.startupCheck) {
      clearTimeout(this.startupCheck)
      this.startupCheck = null
    }
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval)
      this.updateCheckInterval = null
    }
  }

  private updateStatus(partial: Partial<UpdateStatus>): void {
    if (partial.status && partial.status !== this.status.status) mainEditorEvents.publish({
      type: `app.update.${partial.status}`, title: 'notifications.updateChanged', message: 'notifications.openEditor',
      level: partial.status === 'error' ? 'error' : partial.status === 'downloaded' || partial.status === 'available' ? 'success' : 'info',
      attention: ['error', 'downloaded', 'available'].includes(partial.status), correlationId: partial.version,
    })
    this.status = { ...this.status, ...partial }
    this.notifyRenderer()
  }

  private notifyRenderer(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('updater:status', this.status)
    }
  }

  private isNewerVersion(latest: string, current: string): boolean {
    const latestParts = latest.split('.').map(Number)
    const currentParts = current.split(/[+-]/, 1)[0].split('.').map(Number)

    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i += 1) {
      const left = latestParts[i] || 0
      const right = currentParts[i] || 0
      if (left > right) return true
      if (left < right) return false
    }

    return current.split('+', 1)[0].includes('-')
  }

  private findDownloadUrl(assets: Array<{ name: string }>, feed: string): string {
    const key = `${process.platform}-${process.arch}`
    const patterns: Record<string, RegExp[]> = {
      'win32-x64': [/Adnify-Setup-.*-x64\.exe$/i],
      'win32-arm64': [/Adnify-Setup-.*-arm64\.exe$/i],
      'darwin-x64': [/Adnify-.*-x64-mac\.dmg$/i, /Adnify-.*-x64-mac\.zip$/i],
      'darwin-arm64': [/Adnify-.*-arm64-mac\.dmg$/i, /Adnify-.*-arm64-mac\.zip$/i],
      'linux-x64': [/Adnify-.*-x86_64-linux\.AppImage$/i, /Adnify-.*-x64-linux\.AppImage$/i],
      'linux-arm64': [/Adnify-.*-arm64-linux\.AppImage$/i],
    }

    for (const pattern of patterns[key] ?? []) {
      const asset = assets.find(({ name }) => pattern.test(name))
      if (asset) return new URL(encodeURIComponent(asset.name), feed).href
    }
    return CNB_RELEASES_URL
  }
}

export const updateService = new UpdateService()
