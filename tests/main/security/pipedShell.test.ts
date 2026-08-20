import { describe, expect, it } from 'vitest'
import {
  buildShellArgs,
  runPipedShellCommand,
  stripAnsi,
  truncateOutput,
} from '@main/security/pipedShell'

const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'

function run(command: string, overrides: Partial<Parameters<typeof runPipedShellCommand>[0]> = {}) {
  return runPipedShellCommand({
    command,
    cwd: process.cwd(),
    timeoutMs: 20_000,
    shell,
    maxOutputChars: 120_000,
    ...overrides,
  })
}

describe('buildShellArgs', () => {
  it('passes the command as a single argument so its quoting stays intact', () => {
    const args = buildShellArgs('/bin/bash', 'echo "a b" && echo c')
    expect(args).toEqual(['-c', 'echo "a b" && echo c'])
  })

  it('suppresses the PowerShell profile so it cannot pollute captured output', () => {
    const args = buildShellArgs('powershell.exe', 'Write-Output hi')
    expect(args).toContain('-NoProfile')
    expect(args).toContain('-NonInteractive')
    expect(args[args.length - 1]).toContain('Write-Output hi')
  })

  it('routes cmd.exe through /D /S /C with a UTF-8 codepage', () => {
    const args = buildShellArgs('cmd.exe', 'echo hi')
    expect(args.slice(0, 3)).toEqual(['/D', '/S', '/C'])
    expect(args[3]).toContain('chcp 65001')
  })
})

describe('stripAnsi', () => {
  it('removes colour codes and OSC sequences but keeps the text', () => {
    const text = '[32mgreen[0m ]633;Aplain'
    expect(stripAnsi(text)).toBe('green plain')
  })

  it('normalizes CRLF', () => {
    expect(stripAnsi('a\r\nb')).toBe('a\nb')
  })
})

describe('truncateOutput', () => {
  it('keeps the tail, which is where a build failure explains itself', () => {
    const result = truncateOutput('abcdefghij', 4)
    expect(result.truncated).toBe(true)
    expect(result.text).toContain('ghij')
    expect(result.text).toContain('truncated')
  })

  it('leaves short output untouched', () => {
    expect(truncateOutput('short', 100)).toEqual({ text: 'short', truncated: false })
  })
})

describe('runPipedShellCommand', () => {
  it('captures stdout and a zero exit code', async () => {
    const result = await run('echo piped-hello')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('piped-hello')
    expect(result.timedOut).toBe(false)
  })

  // This is the whole point of the fallback: the PTY path reports failure with a
  // null exit code when shell integration is missing, even for commands that
  // succeeded silently.
  it('reports success for a command that produces no output', async () => {
    const result = await run(process.platform === 'win32' ? 'exit 0' : 'true')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  it('reports the real non-zero exit code', async () => {
    const result = await run(process.platform === 'win32' ? 'exit 3' : 'exit 3')
    expect(result.exitCode).toBe(3)
  })

  it('separates stderr from stdout', async () => {
    const command = process.platform === 'win32'
      ? '[Console]::Error.WriteLine("to-stderr"); Write-Output "to-stdout"'
      : 'echo to-stdout; echo to-stderr 1>&2'
    const result = await run(command)
    expect(result.stdout).toContain('to-stdout')
    expect(result.stderr).toContain('to-stderr')
  })

  it('times out and kills the process instead of hanging', async () => {
    const command = process.platform === 'win32' ? 'Start-Sleep -Seconds 30' : 'sleep 30'
    const startedAt = Date.now()
    const result = await run(command, { timeoutMs: 1200 })

    expect(result.timedOut).toBe(true)
    expect(Date.now() - startedAt).toBeLessThan(15_000)
  }, 20_000)

  it('surfaces a spawn failure rather than pretending the command ran', async () => {
    const result = await run('echo nope', { shell: '/definitely/not/a/shell' })
    expect(result.exitCode).not.toBe(0)
    expect(result.error).toBeTruthy()
  })

  it('caps very large output while keeping the end of it', async () => {
    const command = process.platform === 'win32'
      ? '1..4000 | ForEach-Object { "line-$_" }'
      : 'for i in $(seq 1 4000); do echo "line-$i"; done'
    const result = await run(command, { maxOutputChars: 500 })

    expect(result.truncated).toBe(true)
    expect(result.stdout.length).toBeLessThan(2000)
    expect(result.stdout).toContain('line-4000')
  }, 30_000)
})
