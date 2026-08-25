import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { ElevationRequest, ElevationRequestResult, PrivilegeCapability } from '@shared/types/systemPrivilege'
import { systemPrivilegeService } from '../services/systemPrivilegeService'

let elevationRequestInFlight = false
let elevationRelaunchScheduled = false

const CAPABILITY_COPY: Record<PrivilegeCapability, { zh: string; en: string }> = {
  'lsp.install': {
    zh: '系统拒绝了语言工具安装所需的文件访问。',
    en: 'The system denied file access required to install language tooling.',
  },
  'file.writeProtected': {
    zh: '系统拒绝写入当前文件或目录。',
    en: 'The system denied writing to the current file or directory.',
  },
  'config.writeProtected': {
    zh: '系统拒绝写入所选配置目录。',
    en: 'The system denied writing to the selected configuration directory.',
  },
}

function isPrivilegeCapability(value: unknown): value is PrivilegeCapability {
  return typeof value === 'string' && value in CAPABILITY_COPY
}

export function registerSystemPrivilegeHandlers(
  getMainWindow: (windowId?: number) => BrowserWindow | null,
): void {
  ipcMain.handle('systemPrivilege:getStatus', () => systemPrivilegeService.getStatus())

  ipcMain.handle('systemPrivilege:requestElevation', async (event, request: ElevationRequest): Promise<ElevationRequestResult> => {
    if (elevationRequestInFlight || elevationRelaunchScheduled) {
      return { success: false, error: 'An administrator permission request is already in progress.' }
    }

    elevationRequestInFlight = true
    try {
      const status = await systemPrivilegeService.getStatus()
      if (status.elevated) return { success: true, alreadyElevated: true }
      if (!status.canRelaunchElevated) {
        return { success: false, error: `Automatic privilege elevation is not supported on ${status.platform}.` }
      }

      if (!isPrivilegeCapability(request?.capability)) {
        return { success: false, error: 'Unknown privilege capability.' }
      }
      const language = request?.language === 'en' ? 'en' : 'zh'
      const reason = CAPABILITY_COPY[request.capability][language]
      const win = BrowserWindow.fromWebContents(event.sender) || getMainWindow()
      const options = language === 'zh'
        ? {
            type: 'warning' as const,
            title: '需要管理员权限',
            message: '此操作需要管理员权限',
            detail: `${reason || '当前操作需要访问受保护的系统资源。'}\n\n应用将先保存当前状态并退出，随后显示 Windows 用户账户控制提示。重启后整个应用将具有管理员权限，请仅在信任当前操作时继续。`,
            buttons: ['取消', '以管理员身份重启'],
            defaultId: 1,
            cancelId: 0,
            noLink: true,
          }
        : {
            type: 'warning' as const,
            title: 'Administrator permission required',
            message: 'This operation requires administrator permission',
            detail: `${reason || 'The current operation needs access to protected system resources.'}\n\nThe app will save its current state and exit before showing the Windows User Account Control prompt. The entire app will run with administrator privileges after restart; continue only if you trust this operation.`,
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

  ipcMain.handle('systemPrivilege:restartNormally', async () => {
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
