import { describe, expect, it } from 'vitest'
import * as pty from 'node-pty'
import {
  createTerminalCommandFrameState,
  filterCommandDisplayChunk,
  pushTerminalCommandFrame,
  type CommandDisplayFilterState,
} from '@renderer/services/terminalCommandProtocol'

const windowsIt = process.platform === 'win32' ? it : it.skip

describe('terminal command protocol on a real Windows ConPTY', () => {
  windowsIt('suppresses the PowerShell wrapper in both display and captured output', async () => {
    const sentinelId = `real${Date.now().toString(36)}`
    const startPayload = `ADNIFY_CMD_START_${sentinelId}`
    const endPayload = `ADNIFY_CMD_END_${sentinelId}_`
    const startSequence = `\x1b]9001;${startPayload}\x07`
    const frame = createTerminalCommandFrameState(sentinelId)
    const displayFilter: CommandDisplayFilterState = {
      startSequence,
      displayLine: 'PS C:\\workspace> Write-Output actual-output',
      pending: '',
      started: false,
      frame: createTerminalCommandFrameState(sentinelId),
    }
    const shell = pty.spawn('powershell.exe', [
      '-NoLogo',
      '-NoExit',
      '-Command',
      'Remove-Module PSReadLine -ErrorAction SilentlyContinue',
    ], {
      name: 'xterm-256color',
      cols: 40,
      rows: 24,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    })

    let visible = ''
    let captured = ''
    let raw = ''
    const result = await new Promise<{ exitCode: number | null }>((resolve, reject) => {
      const timer = setTimeout(() => {
        shell.kill()
        reject(new Error('Timed out waiting for real PowerShell sentinel'))
      }, 8000)

      shell.onData((data) => {
        raw += data
        visible += filterCommandDisplayChunk(displayFilter, data)
        const framed = pushTerminalCommandFrame(frame, data)
        captured += framed.output
        if (framed.ended) {
          clearTimeout(timer)
          resolve({ exitCode: framed.exitCode })
          shell.kill()
        }
      })

      const command = [
        `[Console]::Out.Write("$([char]27)]9001;${startPayload}$([char]7)")`,
        `& { Write-Output 'actual-output'; cmd.exe /d /c exit 7 } | Out-Host`,
        '$__adnify_ok = $?; $__adnify_lec = $LASTEXITCODE',
        '$__adnify_ec = if ($__adnify_ok) { if ($null -ne $__adnify_lec) { $__adnify_lec } else { 0 } } else { if ($__adnify_lec) { $__adnify_lec } else { 1 } }',
        `[Console]::Out.Write("$([char]27)]9001;${endPayload}$__adnify_ec$([char]7)")`,
      ].join('; ')
      setTimeout(() => shell.write(`${command}\r`), 150)
    })

    expect(result.exitCode).toBe(7)
    expect(captured, JSON.stringify(raw)).toContain('actual-output')
    expect(visible).toContain('PS C:\\workspace> Write-Output actual-output')
    for (const internal of ['[Console]::Out.Write', 'ADNIFY_CMD_', '$__adnify_']) {
      expect(visible).not.toContain(internal)
      expect(captured).not.toContain(internal)
    }
  }, 10_000)
})
