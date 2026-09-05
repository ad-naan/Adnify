import { describe, expect, it } from 'vitest'
import { executionShellArgs, startExecutionProcess } from '@main/services/execution/ProcessRunner'

const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
describe('managed shell process', { timeout: 20_000 }, () => {
  it('keeps the selected shell profile enabled', () => {
    expect(executionShellArgs('powershell.exe', 'echo hello')).not.toContain('-NoProfile')
    expect(executionShellArgs('/bin/bash', 'echo hello')).toEqual(['-i', '-c', 'echo hello'])
  })
  it('captures Unicode and the real nonzero exit code', async () => {
    let output = ''
    const child = startExecutionProcess({ shell, cwd: process.cwd(),
      command: process.platform === 'win32' ? "Write-Output '中文输出'; exit 7" : "printf '中文输出\\n'; exit 7" }, text => { output += text })
    const outcome = await child.done
    expect(outcome.exitCode).toBe(7)
    expect(output).toContain('中文输出')
  })
  it('reports shell errors as failure, including PowerShell non-native commands', async () => {
    const child = startExecutionProcess({ shell, cwd: process.cwd(),
      command: process.platform === 'win32' ? "Write-Error 'expected failure'" : 'false' }, () => {})
    expect((await child.done).exitCode).not.toBe(0)
  })
  it('waits for actual process closure after stopping', async () => {
    let ready!: () => void
    const started = new Promise<void>(resolve => { ready = resolve })
    const child = startExecutionProcess({ shell, cwd: process.cwd(), command: process.platform === 'win32'
      ? "Write-Output 'ready'; Start-Sleep -Seconds 60" : "printf 'ready\\n'; sleep 60" }, text => { if (text.includes('ready')) ready() })
    try {
      await started
      await child.stop()
      expect((await child.done).exitCode).not.toBe(0)
    } finally { await child.stop() }
  })
  it.runIf(process.platform === 'win32')('runs a quoted executable path through cmd.exe', async () => {
    let output = ''
    const child = startExecutionProcess({ shell: 'cmd.exe', cwd: process.cwd(),
      command: `"${process.execPath}" --version` }, text => { output += text })
    expect((await child.done).exitCode).toBe(0)
    expect(output).toContain(process.version)
  })
})
