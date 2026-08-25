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
