import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  cleanupRelaunchHandshake,
  buildWindowsLaunchScript,
  createRelaunchTicket,
  parseRelaunchContext,
  signalRelaunchReady,
  waitForParentExit,
  waitForRelaunchReady,
  type RelaunchTicket,
} from '@main/services/relaunchProtocol'

const tickets: RelaunchTicket[] = []
const execFileAsync = promisify(execFile)

afterEach(() => {
  tickets.splice(0).forEach(cleanupRelaunchHandshake)
})

describe('relaunch protocol', () => {
  it('round-trips a validated handoff context', () => {
    const ticket = createRelaunchTicket()
    tickets.push(ticket)
    expect(parseRelaunchContext(ticket.args)).toEqual({
      token: ticket.token,
      parentPid: ticket.parentPid,
      handshakePath: ticket.handshakePath,
    })
  })

  it('rejects a handshake path that does not match the token', () => {
    const ticket = createRelaunchTicket()
    tickets.push(ticket)
    const tamperedArgs = ticket.args.map(arg => arg.startsWith('--adnify-relaunch-handshake=')
      ? `--adnify-relaunch-handshake=${Buffer.from('C:\\Windows\\temp.ready').toString('base64url')}`
      : arg)
    expect(parseRelaunchContext(tamperedArgs)).toBeNull()
  })

  it('waits for a matching replacement readiness signal', async () => {
    const ticket = createRelaunchTicket()
    tickets.push(ticket)
    signalRelaunchReady(ticket)
    await expect(waitForRelaunchReady(ticket, 250)).resolves.toBe(true)
    expect(fs.existsSync(ticket.handshakePath)).toBe(true)
  })

  it('detects an already-exited parent', async () => {
    const ticket = createRelaunchTicket()
    tickets.push(ticket)
    await expect(waitForParentExit({ ...ticket, parentPid: 2_147_483_647 }, 250)).resolves.toBe(true)
  })

  // 降权重启（Shell.Application）会让中完整性的新进程去探测高完整性的旧进程，
  // Windows 返回 ERROR_ACCESS_DENIED → EPERM。把它当成「已退出」等于整个握手不存在：
  // 新进程立刻去抢 single-instance 锁，而旧进程的 before-quit 清理还要好几秒，
  // 抢不到就退出 —— 用户点了「以普通权限重启」却什么都没打开。
  it('keeps waiting when the parent handle is not accessible (EPERM)', async () => {
    const ticket = createRelaunchTicket()
    tickets.push(ticket)
    const realKill = process.kill
    let probes = 0
    process.kill = ((pid: number, signal?: string | number) => {
      if (signal === 0 && pid === ticket.parentPid) {
        probes += 1
        const error = new Error('operation not permitted') as NodeJS.ErrnoException
        error.code = 'EPERM'
        throw error
      }
      return realKill(pid, signal as never)
    }) as typeof process.kill

    try {
      await expect(waitForParentExit(ticket, 300)).resolves.toBe(false)
    } finally {
      process.kill = realKill
    }
    expect(probes).toBeGreaterThan(1)
  })

  it('stops waiting as soon as the parent probe reports ESRCH', async () => {
    const ticket = createRelaunchTicket()
    tickets.push(ticket)
    const realKill = process.kill
    let probes = 0
    process.kill = ((pid: number, signal?: string | number) => {
      if (signal === 0 && pid === ticket.parentPid) {
        probes += 1
        if (probes < 2) return true
        const error = new Error('no such process') as NodeJS.ErrnoException
        error.code = 'ESRCH'
        throw error
      }
      return realKill(pid, signal as never)
    }) as typeof process.kill

    try {
      await expect(waitForParentExit(ticket, 5_000)).resolves.toBe(true)
    } finally {
      process.kill = realKill
    }
    expect(probes).toBe(2)
  })

  it('encodes executable paths and arguments in elevated and normal launch scripts', () => {
    const executable = 'C:\\Program Files\\Adnify\\Adnify.exe'
    const args = ['C:\\Project With Spaces\\app', '--adnify-relaunch-token=token']
    const elevated = buildWindowsLaunchScript(executable, args, true)
    const normal = buildWindowsLaunchScript(executable, args, false)

    expect(elevated).toContain('-Verb RunAs')
    expect(normal).toContain('Shell.Application')
    expect(elevated).not.toContain(executable)
    expect(elevated).not.toContain(args[0])
  })

  it.runIf(process.platform === 'win32')('produces syntactically valid PowerShell', async () => {
    const launchScript = buildWindowsLaunchScript(
      'C:\\Program Files\\Adnify\\Adnify.exe',
      ['C:\\Project With Spaces\\app', '--adnify-relaunch-token=token'],
      true,
    )
    const launchScriptBase64 = Buffer.from(launchScript, 'utf16le').toString('base64')
    const parserScript = [
      `$source = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${launchScriptBase64}'))`,
      '$tokens = $null',
      '$errors = $null',
      '[Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors) | Out-Null',
      'if ($errors.Count -gt 0) { Write-Error ($errors | Out-String); exit 1 }',
    ].join('; ')
    const encodedParser = Buffer.from(parserScript, 'utf16le').toString('base64')

    await expect(execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle', 'Hidden',
      '-EncodedCommand', encodedParser,
    ], { windowsHide: true, timeout: 5_000 })).resolves.toBeDefined()
  })
})
