import { app, type WebContents } from 'electron'
import { execFile } from 'child_process'
import { logger } from '@shared/utils/Logger'
import type { ElevationRequestResult, NormalRelaunchResult, PrivilegeCapability, SystemPrivilegeStatus } from '@shared/types/systemPrivilege'
import {
  cleanupRelaunchHandshake,
  buildWindowsLaunchScript,
  createRelaunchTicket,
  waitForRelaunchReady,
} from './relaunchProtocol'

function isWindowsUacCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /(?:cancel(?:ed|led)|1223)/i.test(message)
}

const WINDOWS_ADMIN_CHECK = [
  '$identity = [Security.Principal.WindowsIdentity]::GetCurrent()',
  '$principal = [Security.Principal.WindowsPrincipal]::new($identity)',
  '$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
].join('; ')

function isWindowsElevated(): Promise<boolean> {
  return new Promise(resolve => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', WINDOWS_ADMIN_CHECK],
      { windowsHide: true, timeout: 5000 },
      (error, stdout) => resolve(!error && stdout.trim().toLowerCase() === 'true'),
    )
  })
}

function executePowerShell(script: string): Promise<void> {
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodedScript],
      { windowsHide: true, timeout: 30_000 },
      error => error ? reject(error) : resolve(),
    )
  })
}

async function launchWindowsReplacement(elevated: boolean): Promise<void> {
  const ticket = createRelaunchTicket()
  const launchArgs = [
    ...(!app.isPackaged && process.argv[1] ? [process.argv[1]] : []),
    ...ticket.args,
  ]
  const script = buildWindowsLaunchScript(app.getPath('exe'), launchArgs, elevated)

  try {
    await executePowerShell(script)
    if (!await waitForRelaunchReady(ticket)) {
      throw new Error('The replacement application did not become ready in time.')
    }
  } catch (error) {
    cleanupRelaunchHandshake(ticket)
    throw error
  }
}

class SystemPrivilegeService {
  private readonly lastNotificationAt = new Map<string, number>()

  notifyPermissionRequired(webContents: WebContents, capability: PrivilegeCapability): void {
    if (webContents.isDestroyed()) return
    const key = `${webContents.id}:${capability}`
    const now = Date.now()
    if (now - (this.lastNotificationAt.get(key) || 0) < 2_000) return
    this.lastNotificationAt.set(key, now)
    webContents.send('systemPrivilege:required', { capability })
  }

  async getStatus(): Promise<SystemPrivilegeStatus> {
    if (process.platform === 'win32') {
      return {
        platform: process.platform,
        elevated: await isWindowsElevated(),
        canRelaunchElevated: true,
      }
    }

    return {
      platform: process.platform,
      elevated: typeof process.getuid === 'function' && process.getuid() === 0,
      canRelaunchElevated: false,
    }
  }

  async scheduleElevatedRelaunch(): Promise<ElevationRequestResult> {
    const status = await this.getStatus()
    if (status.elevated) {
      return { success: true, alreadyElevated: true }
    }
    if (!status.canRelaunchElevated) {
      return {
        success: false,
        error: `Automatic privilege elevation is not supported on ${status.platform}.`,
      }
    }

    try {
      await launchWindowsReplacement(true)
      logger.security.info('[Privilege] Elevated replacement is ready for handoff')
      return { success: true, scheduled: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isWindowsUacCancellation(error)) {
        logger.security.info('[Privilege] Windows elevation was canceled by the user')
        return { success: false, canceled: true }
      }
      logger.security.error('[Privilege] Failed to schedule elevated relaunch', { error: message })
      return { success: false, error: message }
    }
  }

  async scheduleNormalRelaunch(): Promise<NormalRelaunchResult> {
    const status = await this.getStatus()
    if (!status.elevated) return { success: true, alreadyNormal: true }
    if (status.platform !== 'win32') {
      return { success: false, error: `Automatic normal relaunch is not supported on ${status.platform}.` }
    }

    try {
      await launchWindowsReplacement(false)
      logger.security.info('[Privilege] Normal replacement is ready for handoff')
      return { success: true, scheduled: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.security.error('[Privilege] Failed to schedule normal relaunch', { error: message })
      return { success: false, error: message }
    }
  }
}

export const systemPrivilegeService = new SystemPrivilegeService()
