import { describe, expect, it } from 'vitest'
import * as pty from 'node-pty'
import * as path from 'node:path'
import { createShellIntegrationOscParser } from '@renderer/services/terminalShellIntegration'

const windowsIt = process.platform === 'win32' ? it : it.skip

describe('shell integration on a real Windows ConPTY', () => {
  windowsIt('reports command completion for mixed PowerShell statements', async () => {
    const script = path.resolve(process.cwd(), 'resources/shell-integration/shellIntegration.ps1')
    const shell = pty.spawn('powershell.exe', [
      '-NoLogo',
      '-NoExit',
      '-Command',
      `$null = chcp 65001; . '${script.replace(/'/g, "''")}'`,
    ], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    })

    const parser = createShellIntegrationOscParser()
    const payloads: string[] = []
    let raw = ''

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Timed out; raw=${JSON.stringify(raw)}`))
        }, 10_000)
        shell.onData(data => {
          raw += data
          payloads.push(...parser.push(data))
          const phases = payloads.map(payload => payload.split(';', 1)[0])
          const submitted = phases.indexOf('C')
          if (
            submitted >= 0 &&
            phases.slice(submitted + 1).includes('D') &&
            phases.slice(submitted + 1).includes('A')
          ) {
            clearTimeout(timer)
            resolve()
          }
        })
        setTimeout(() => shell.write('echo "Hello from Adnify Shell"; Get-Date; $PSVersionTable.PSVersion\r'), 250)
      })

      expect(raw).toContain('Hello from Adnify Shell')
      expect(payloads).toContain('C')
      expect(payloads.some(payload => /^D;0(?:;|$)/.test(payload))).toBe(true)
      expect(payloads.some(payload => payload === 'A')).toBe(true)
    } finally {
      shell.kill()
    }
  }, 15_000)
})
