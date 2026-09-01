import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { ElevationRequest, ElevationRequestResult } from '@shared/types/systemPrivilege'
import { systemPrivilegeService } from '../services/systemPrivilegeService'
import { ensureTrustedIpcSender } from './safeHandle'
import { isPrivilegeCapability, PRIVILEGE_CAPABILITY_REASON_KEYS } from '../services/privilegeCapabilities'
import { asLanguage, t } from '@shared/i18n'

let elevationRequestInFlight = false
let elevationRelaunchScheduled = false

export function registerSystemPrivilegeHandlers(
  getMainWindow: (windowId?: number) => BrowserWindow | null,
): void {
  ipcMain.handle('systemPrivilege:getStatus', event => {
    ensureTrustedIpcSender(event)
    return systemPrivilegeService.getStatus()
  })

  ipcMain.handle('systemPrivilege:requestElevation', async (event, request: ElevationRequest): Promise<ElevationRequestResult> => {
    ensureTrustedIpcSender(event)
    if (elevationRequestInFlight || elevationRelaunchScheduled) {
      return { success: false, error: 'An administrator permission request is already in progress.' }
    }

    elevationRequestInFlight = true
    try {
      if (!isPrivilegeCapability(request?.capability)) {
        return { success: false, error: 'Unknown privilege capability.' }
      }
      const status = await systemPrivilegeService.getStatus()
      if (status.elevated) return { success: true, alreadyElevated: true }
      if (!status.canRelaunchElevated) {
        return { success: false, error: `Automatic privilege elevation is not supported on ${status.platform}.` }
      }

      // 未指定语言时按应用默认（en）走，而不是中文：这个弹窗是原生 dialog，
      // 文案只能由主进程自己查。
      const language = asLanguage(request?.language)
      const reason = t(PRIVILEGE_CAPABILITY_REASON_KEYS[request.capability], language)
      const win = BrowserWindow.fromWebContents(event.sender) || getMainWindow()
      const options = {
        type: 'warning' as const,
        title: t('privilegeDialog.title', language),
        message: t('privilegeDialog.message', language),
        detail: t('privilegeDialog.detail', language, { reason }),
        buttons: [t('cancel', language), t('privilegeDialog.restartAsAdmin', language)],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
      }

      const choice = win
        ? await dialog.showMessageBox(win, options)
        : await dialog.showMessageBox(options)
      if (choice.response !== 1) return { success: false, canceled: true }

      const result = await systemPrivilegeService.scheduleElevatedRelaunch()
      if (result.scheduled) {
        elevationRelaunchScheduled = true
        // Give the IPC response time to reach the renderer. The existing shutdown
        // flow remains responsible for flushing sessions and window state.
        setTimeout(() => app.quit(), 150)
      }
      return result
    } finally {
      elevationRequestInFlight = false
    }
  })

  ipcMain.handle('systemPrivilege:restartNormally', async event => {
    ensureTrustedIpcSender(event)
    if (elevationRequestInFlight || elevationRelaunchScheduled) {
      return { success: false, error: 'An application relaunch is already in progress.' }
    }
    const result = await systemPrivilegeService.scheduleNormalRelaunch()
    if (result.scheduled) {
      elevationRelaunchScheduled = true
      setTimeout(() => app.quit(), 150)
    }
    return result
  })
}
