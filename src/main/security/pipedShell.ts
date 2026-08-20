/**
 * Run a shell command through pipes and report its real result.
 *
 * `run_command` normally drives an interactive PTY so the user can watch, and
 * relies on OSC 633 shell integration to learn where a command starts, where it
 * ends, and what it exited with. When those markers never arrive — cmd.exe has
 * no integration script, and a user rc-file can replace the hooks — the PTY path
 * has no way to distinguish "succeeded quietly" from "never ran", so it reports
 * failure with a null exit code even though the output is on screen.
 *
 * Piped stdio has none of that ambiguity: stdout/stderr are the process's own
 * streams and the exit code comes from the process itself. This module is that
 * fallback. It deliberately carries no command whitelist — it is reached only
 * from the same agent tool call as the PTY path, behind the same approval UI, so
 * adding a second policy here would just make identical commands succeed or fail
 * depending on which transport happened to be chosen.
 */

import { spawn } from 'child_process'
import { StringDecoder } from 'node:string_decoder'
import * as path from 'path'
import { logger } from '@shared/utils/Logger'
import { toAppError } from '@shared/utils/errorHandler'

export interface PipedShellOptions {
  command: string
  cwd: string
  timeoutMs: number
  shell?: string
  maxOutputChars: number
  onExit?: (pid: number) => void
  onSpawn?: (pid: number) => void
}

export interface PipedShellOutcome {
  stdout: string
  stderr: string
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  truncated: boolean
  durationMs: number
  error?: string
}

type ShellKind = 'powershell' | 'cmd' | 'posix'

function classifyShell(shellPath: string): ShellKind {
  const name = path.basename(shellPath).toLowerCase()
  if (name === 'powershell.exe' || name === 'powershell' || name === 'pwsh.exe' || name === 'pwsh') {
    return 'powershell'
  }
  if (name === 'cmd.exe' || name === 'cmd') return 'cmd'
  return 'posix'
}

export function resolveDefaultShell(): string {
  if (process.platform === 'win32') return 'powershell.exe'
  return process.env.SHELL || '/bin/bash'
}

/**
 * Build the argv that hands `command` to `shellPath` as a single script.
 *
 * The command string is passed as one argument rather than interpolated into a
 * larger script, so quoting inside it is the shell's business and cannot alter
 * the surrounding argv.
 */
export function buildShellArgs(shellPath: string, command: string): string[] {
  switch (classifyShell(shellPath)) {
    case 'powershell':
      // -NoProfile keeps a user profile from writing to stdout and polluting the
      // captured output. UTF-8 is forced so non-ASCII output survives the pipe.
      return [
        '-NoProfile',
        '-NoLogo',
        '-NonInteractive',
        '-Command',
        '$__adnifyUtf8 = New-Object System.Text.UTF8Encoding($false);'
          + ' $OutputEncoding = $__adnifyUtf8;'
          + ' [Console]::OutputEncoding = $__adnifyUtf8;'
          + ` ${command}`,
      ]
    case 'cmd':
      return ['/D', '/S', '/C', `chcp 65001 > nul & ${command}`]
    default:
      return ['-c', command]
  }
}

/** Keep the tail: the end of a long build log is what explains the outcome. */
export function truncateOutput(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  return {
    text: `[... ${text.length - maxChars} characters truncated ...]\n${text.slice(-maxChars)}`,
    truncated: true,
  }
}

export function runPipedShellCommand(options: PipedShellOptions): Promise<PipedShellOutcome> {
  const { command, cwd, timeoutMs, maxOutputChars } = options
  const shellPath = options.shell || resolveDefaultShell()
  const startedAt = Date.now()

  return new Promise<PipedShellOutcome>((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(shellPath, buildShellArgs(shellPath, command), {
        cwd,
        // TERM=dumb stops tools from emitting colour escapes and progress
        // redraws, which are noise once the output is text for a model.
        env: { ...process.env, TERM: 'dumb' },
        windowsHide: true,
      })
    } catch (error) {
      resolve({
        stdout: '',
        stderr: '',
        exitCode: null,
        signal: null,
        timedOut: false,
        truncated: false,
        durationMs: Date.now() - startedAt,
        error: toAppError(error).message,
      })
      return
    }

    if (child.pid) options.onSpawn?.(child.pid)

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    // A UTF-8 character can be split across two chunks; decoding each chunk
    // independently would turn it into U+FFFD.
    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')

    // Cap while streaming so a runaway process cannot exhaust memory before the
    // timeout fires. Keeping 2x the reported budget leaves room for the tail
    // slice to still be a clean cut.
    const streamCap = maxOutputChars * 2
    child.stdout?.on('data', (data: Buffer) => {
      stdout += stdoutDecoder.write(data)
      if (stdout.length > streamCap) stdout = stdout.slice(-streamCap)
    })
    child.stderr?.on('data', (data: Buffer) => {
      stderr += stderrDecoder.write(data)
      if (stderr.length > streamCap) stderr = stderr.slice(-streamCap)
    })

    const timer = setTimeout(() => {
      timedOut = true
      killProcessTree(child)
    }, timeoutMs)

    const finish = (exitCode: number | null, signal: string | null, error?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (child.pid) options.onExit?.(child.pid)

      stdout += stdoutDecoder.end()
      stderr += stderrDecoder.end()

      const cleanedStdout = truncateOutput(stripAnsi(stdout), maxOutputChars)
      const cleanedStderr = truncateOutput(stripAnsi(stderr), maxOutputChars)

      resolve({
        stdout: cleanedStdout.text,
        stderr: cleanedStderr.text,
        exitCode,
        signal,
        timedOut,
        truncated: cleanedStdout.truncated || cleanedStderr.truncated,
        durationMs: Date.now() - startedAt,
        error,
      })
    }

    child.on('close', (code, signal) => finish(code, signal))
    child.on('error', (error) => {
      logger.security.error('[PipedShell] Spawn failed:', error)
      finish(null, null, toAppError(error).message)
    })
  })
}

/**
 * ANSI escapes still reach us from tools that write them unconditionally.
 * Strips CSI/OSC sequences and normalizes CRLF; the text is for a model to read.
 */
export function stripAnsi(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[()][0-9A-B]/g, '')
    .replace(/\r\n/g, '\n')
}

/**
 * Kill the whole tree. A shell that spawned children leaves them running (and
 * holding the pipes open) if only the shell itself is signalled.
 */
function killProcessTree(child: ReturnType<typeof spawn>): void {
  const pid = child.pid
  if (!pid) return

  if (process.platform === 'win32') {
    spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true })
      .on('error', () => {
        try { child.kill('SIGKILL') } catch { /* already gone */ }
      })
    return
  }

  try { child.kill('SIGTERM') } catch { /* already gone */ }
  // SIGTERM can be ignored; escalate so the promise cannot hang forever.
  setTimeout(() => {
    try { if (!child.killed) child.kill('SIGKILL') } catch { /* already gone */ }
  }, 2000)
}
