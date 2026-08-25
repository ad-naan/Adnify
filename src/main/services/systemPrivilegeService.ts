import { app, type WebContents } from 'electron'
import { execFile, spawn } from 'child_process'
import { logger } from '@shared/utils/Logger'
import type { ElevationRequestResult, NormalRelaunchResult, PrivilegeCapability, SystemPrivilegeStatus } from '@shared/types/systemPrivilege'

const PERMISSION_ERROR_CODES = new Set(['EACCES', 'EPERM'])

export function isSystemPermissionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error ? String(error.code) : ''
  return PERMISSION_ERROR_CODES.has(code.toUpperCase())
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

function scheduleWindowsElevatedRelaunch(): Promise<void> {
  const executableBase64 = Buffer.from(app.getPath('exe'), 'utf8').toString('base64')
  const script = [
    `$parentPid = ${process.pid}`,
    'Wait-Process -Id $parentPid -ErrorAction SilentlyContinue',
    `$exe = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${executableBase64}'))`,
    'Start-Process -FilePath $exe -Verb RunAs',
  ].join('; ')
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64')

  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodedScript],
      { detached: true, stdio: 'ignore', windowsHide: true },
    )
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

function scheduleWindowsNormalRelaunch(): Promise<void> {
  const executableBase64 = Buffer.from(app.getPath('exe'), 'utf8').toString('base64')
  const script = [
    `$parentPid = ${process.pid}`,
    'Wait-Process -Id $parentPid -ErrorAction SilentlyContinue',
    `$exe = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${executableBase64}'))`,
    // Explorer runs at the interactive user's normal integrity level and launches
    // the executable without inheriting this process' elevated token.
    'Start-Process -FilePath explorer.exe -ArgumentList (\'"\' + $exe + \'"\')',
  ].join('; ')
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64')

  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodedScript],
      { detached: true, stdio: 'ignore', windowsHide: true },
    )
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

class SystemPrivilegeService {
  notifyPermissionRequired(webContents: WebContents, capability: PrivilegeCapability): void {
    if (webContents.isDestroyed()) return
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
      await scheduleWindowsElevatedRelaunch()
      logger.security.info('[Privilege] Elevated relaunch scheduled after application exit')
      return { success: true, scheduled: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
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
      await scheduleWindowsNormalRelaunch()
      logger.security.info('[Privilege] Normal relaunch scheduled after application exit')
      return { success: true, scheduled: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.security.error('[Privilege] Failed to schedule normal relaunch', { error: message })
      return { success: false, error: message }
    }
  }
}

export const systemPrivilegeService = new SystemPrivilegeService()
