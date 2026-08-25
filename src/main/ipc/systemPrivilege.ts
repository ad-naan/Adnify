import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { ElevationRequest, ElevationRequestResult } from '@shared/types/systemPrivilege'
import { systemPrivilegeService } from '../services/systemPrivilegeService'
import { ensureTrustedIpcSender } from './safeHandle'
import { isPrivilegeCapability, PRIVILEGE_CAPABILITY_COPY } from '../services/privilegeCapabilities'

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

      const language = request?.language === 'en' ? 'en' : 'zh'
      const reason = PRIVILEGE_CAPABILITY_COPY[request.capability][language]
      const win = BrowserWindow.fromWebContents(event.sender) || getMainWindow()
      const options = language === 'zh'
        ? {
            type: 'warning' as const,
            title: '需要管理员权限',
            message: '此操作需要管理员权限',
            detail: `${reason || '当前操作需要访问受保护的系统资源。'}\n\nWindows 将先显示用户账户控制提示。只有管理员模式的新进程成功启动后，当前应用才会保存状态并退出。重启后整个应用将具有管理员权限，请仅在信任当前操作时继续。`,
            buttons: ['取消', '以管理员身份重启'],
            defaultId: 1,
            cancelId: 0,
            noLink: true,
          }
        : {
            type: 'warning' as const,
            title: 'Administrator permission required',
            message: 'This operation requires administrator permission',
            detail: `${reason || 'The current operation needs access to protected system resources.'}\n\nWindows will show the User Account Control prompt first. The current app will save its state and exit only after the elevated replacement starts successfully. The entire app will run with administrator privileges after restart; continue only if you trust this operation.`,
            buttons: ['Cancel', 'Restart as administrator'],
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
