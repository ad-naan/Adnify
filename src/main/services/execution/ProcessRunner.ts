import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import * as path from 'node:path'

export interface ProcessOutcome { exitCode: number | null; signal?: string; error?: string }
export interface ProcessHandle {
  done: Promise<ProcessOutcome>
  stop(): void | Promise<void>
  input(data: string): void
}
export interface ProcessSpec { command: string; cwd: string; shell: string }

/** Keep the selected shell's profile. Each command still gets an isolated shell environment. */
export function executionShellArgs(shell: string, command: string): string[] {
  const name = path.basename(shell).toLowerCase()
  if (/^(powershell|pwsh)(\.exe)?$/.test(name)) return ['-NoLogo', '-Command',
    '$__adnifyUtf8 = New-Object System.Text.UTF8Encoding($false); '
    + '$OutputEncoding = $__adnifyUtf8; [Console]::OutputEncoding = $__adnifyUtf8; '
    + `$global:LASTEXITCODE = $null; & { ${command}\n $__adnifyOk = $?; `
    + 'if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }; if (-not $__adnifyOk) { exit 1 } }']
  if (/^cmd(\.exe)?$/.test(name)) return ['/D', '/S', '/C', `"chcp 65001 > nul & ${command}"`]
  // Interactive configuration supplies the same user environment as manual terminals.
  if (/^(bash|zsh)(\.exe)?$/.test(name)) return ['-i', '-c', command]
  return ['-c', command]
}

export function startExecutionProcess(spec: ProcessSpec, output: (data: string) => void): ProcessHandle {
  const child: ChildProcessWithoutNullStreams = spawn(spec.shell, executionShellArgs(spec.shell, spec.command), {
    cwd: spec.cwd, env: { ...process.env, TERM: 'dumb' }, windowsHide: true,
    detached: process.platform !== 'win32', stdio: 'pipe',
    windowsVerbatimArguments: process.platform === 'win32' && /^cmd(\.exe)?$/i.test(path.basename(spec.shell)),
  })
  let exited = false
  let stopping = false
  let escalation: ReturnType<typeof setTimeout> | undefined
  const stdout = new StringDecoder('utf8')
  const stderr = new StringDecoder('utf8')
  child.stdout.on('data', chunk => output(stdout.write(chunk)))
  child.stderr.on('data', chunk => output(stderr.write(chunk)))
  const done = new Promise<ProcessOutcome>((resolve) => {
    let error: string | undefined
    child.on('error', err => { error = err.message })
    child.once('close', (code, signal) => {
      exited = true
      clearTimeout(escalation)
      output(stdout.end())
      output(stderr.end())
      resolve({ exitCode: code, signal: signal || undefined, error })
    })
  })
  const signalTree = (signal: NodeJS.Signals) => {
    if (exited || !child.pid) return
    try { process.kill(-child.pid, signal) } catch { try { child.kill(signal) } catch { /* exited */ } }
  }
  return {
    done,
    stop() {
      if (exited || stopping) return
      stopping = true
      if (process.platform === 'win32' && child.pid) {
        return new Promise<void>((resolve, reject) => {
          execFile('taskkill', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true, timeout: 5000 }, error => {
            // Killing only the shell would orphan children and destroy our ability to stop the tree.
            if (error && !exited) { stopping = false; reject(error) }
            else resolve()
          })
        })
      } else {
        signalTree('SIGTERM')
        escalation = setTimeout(() => signalTree('SIGKILL'), 2000)
        escalation.unref?.()
      }
    },
    input(data) {
      if (exited || stopping) throw new Error('Process is not accepting input')
      child.stdin.write(data)
    },
  }
}
