/**
 * Renderer-side updater service.
 */

import { api } from './electronAPI'

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  releaseNotes?: string
  releaseDate?: string
  downloadUrl?: string
  progress?: number
  error?: string
  requiresManualDownload: boolean
  isPortable: boolean
}

class UpdaterService {
  private listeners: Set<(status: UpdateStatus) => void> = new Set()
  private currentStatus: UpdateStatus | null = null
  private unsubscribe: (() => void) | null = null

  initialize(): void {
    this.unsubscribe = api.updater.onStatus((status: UpdateStatus) => {
      this.currentStatus = status
      this.notifyListeners(status)
    })

    void this.getStatus()
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    const status = await api.updater.check()
    this.currentStatus = status
    return status
  }

  async getStatus(): Promise<UpdateStatus> {
    const status = await api.updater.getStatus()
    this.currentStatus = status
    return status
  }

  async downloadUpdate(): Promise<UpdateStatus> {
    const status = await api.updater.download()
    this.currentStatus = status
    return status
  }

  installAndRestart(): void {
    api.updater.install()
  }

  openDownloadPage(url?: string): void {
    api.updater.openDownloadPage(url)
  }

  getCachedStatus(): UpdateStatus | null {
    return this.currentStatus
  }

  subscribe(callback: (status: UpdateStatus) => void): () => void {
    this.listeners.add(callback)

    if (this.currentStatus) {
      callback(this.currentStatus)
    }

    return () => {
      this.listeners.delete(callback)
    }
  }

  destroy(): void {
    this.unsubscribe?.()
    this.listeners.clear()
  }

  private notifyListeners(status: UpdateStatus): void {
    this.listeners.forEach(callback => callback(status))
  }
}

export const updaterService = new UpdaterService()
