/**
 * Updater IPC handlers.
 */

import { ipcMain, shell } from 'electron'
import { updateService } from '../services/updater'

export function registerUpdaterHandlers(): void {
  ipcMain.handle('updater:check', async () => {
    return updateService.checkForUpdates()
  })

  ipcMain.handle('updater:getStatus', () => {
    return updateService.getStatus()
  })

  ipcMain.handle('updater:download', async () => {
    await updateService.downloadUpdate()
    return updateService.getStatus()
  })

  ipcMain.handle('updater:install', () => {
    updateService.quitAndInstall()
  })

  ipcMain.handle('updater:openDownloadPage', (_, url?: string) => {
    const status = updateService.getStatus()
    const targetUrl = url || status.downloadUrl || 'https://github.com/adnaan-worker/adnify/releases/latest'
    void shell.openExternal(targetUrl)
  })
}
