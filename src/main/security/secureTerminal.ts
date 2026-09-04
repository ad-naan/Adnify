/**
 * 安全的终端执行模块（替代原有 terminal.ts 中的高危功能）
 */

import { logger } from '@shared/utils/Logger'
import { toAppError } from '@shared/utils/errorHandler'
import { createKeyedLeadingEdgeThrottle } from '@shared/utils/keyedLeadingEdgeThrottle'
import { BrowserWindow, app, ipcMain } from 'electron'
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import * as fs from 'fs'
const execFileAsync = promisify(execFile)
import { EventEmitter } from 'events'
import { StringDecoder } from 'node:string_decoder'
import { securityManager, OperationType } from './securityModule'
import { SECURITY_SETTINGS_DEFAULTS } from '@shared/config/securitySettings'
import { safeIpcHandle } from '../ipc/safeHandle'
import { normalizePipeTerminalInput } from './terminalInput'
import { runPipedShellCommand } from './pipedShell'
import { exec as gitExec } from 'dugite'
import { remoteHostTrustService } from '../services/remoteHostTrustService'
import {
  assessGitCommand,
  assessShellCommand,
  commandApprovalScope,
  isRecentAgentApprovalProof,
  requireExternalPathApproval,
  type AgentApprovalProof,
  type ExecutionDecision,
  type ExecutionReason,
} from '@shared/security/executionPolicy'
import { assessWorktreeLaneCommand } from './worktreeLanePolicy'
import { randomUUID } from 'node:crypto'


interface SecureShellRequest {
  command: string
  args?: string[]
  cwd?: string
  timeout?: number
}

/**
 * A shell command to run through pipes rather than an interactive PTY.
 *
 * This is the fallback for `run_command` when terminal shell integration cannot
 * report command boundaries (cmd.exe, or a failed OSC 633 handshake). Piped
 * stdio gives the real stdout/stderr and the real exit code, so the agent can
 * never be told a command failed when it actually succeeded.
 */
interface PipedShellRequest {
  command: string
  cwd?: string
  timeout?: number
  shell?: string
  maxOutputChars?: number
  authorizationId?: string
}

interface PipedShellResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  truncated: boolean
  durationMs: number
  error?: string
}

interface CommandWhitelist {
  shell: Set<string>
  git: Set<string>
}

// 白名单配置（已统一到 shared/config/securitySettings.ts）
const WHITELIST: CommandWhitelist = {
  shell: new Set(SECURITY_SETTINGS_DEFAULTS.allowedShellCommands.map(cmd => cmd.toLowerCase())),
  git: new Set(SECURITY_SETTINGS_DEFAULTS.allowedGitSubcommands.map(cmd => cmd.toLowerCase())),
}

// 更新白名单配置
export function updateWhitelist(shellCommands: string[], gitCommands: string[]) {
  WHITELIST.shell = new Set(shellCommands.map(cmd => cmd.toLowerCase()))
  WHITELIST.git = new Set(gitCommands.map(cmd => cmd.toLowerCase()))
  logger.security.info('[Security] Whitelist updated:', {
    shell: Array.from(WHITELIST.shell),
    git: Array.from(WHITELIST.git)
  })
}

// Terminal instances storage (模块级别，便于清理)
const terminals = new Map<string, any>() // IPty instances
const backgroundProcesses = new Map<number, import('child_process').ChildProcess>() // shell:executeBackground 子进程
/** PIDs of in-flight shell:runPiped children, so app shutdown can reap them. */
const pipedShellPids = new Set<number>()
const commandAuthorizations = new Map<string, { command: string; cwd: string; expiresAt: number }>()
const COMMAND_AUTHORIZATION_TTL_MS = 2 * 60 * 1000

function normalizeAuthorizationCwd(cwd: string): string {
  const resolved = path.resolve(cwd)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function issueCommandAuthorization(command: string, cwd: string): string {
  const now = Date.now()
  for (const [id, authorization] of commandAuthorizations) {
    if (authorization.expiresAt <= now) commandAuthorizations.delete(id)
  }
  const id = randomUUID()
  commandAuthorizations.set(id, {
    command: command.trim(),
    cwd: normalizeAuthorizationCwd(cwd),
    expiresAt: now + COMMAND_AUTHORIZATION_TTL_MS,
  })
  return id
}

function consumeCommandAuthorization(id: string | undefined, command: string, cwd: string): boolean {
  if (!id) return false
  const authorization = commandAuthorizations.get(id)
  commandAuthorizations.delete(id)
  if (!authorization || authorization.expiresAt <= Date.now()) {
    return false
  }
  return authorization.command === command.trim()
    && authorization.cwd === normalizeAuthorizationCwd(cwd)
}

function getShellIntegrationResourcePath(scriptName: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'shell-integration', scriptName)
    : path.join(app.getAppPath(), 'resources', 'shell-integration', scriptName)
}

function getPowerShellIntegrationCommand(): string {
  const scriptPath = getShellIntegrationResourcePath('shellIntegration.ps1')
  const literalPath = scriptPath.replace(/'/g, "''")

  // The startup command itself is not echoed by an interactive PowerShell
  // host. Unlike the old per-command wrapper, users only see their own prompt
  // and commands.
  return `$null = chcp 65001; . '${literalPath}'`
}

function getShellBasename(shellPath: string): string {
  return path.basename(shellPath).toLowerCase()
}

function getUnixShellKind(shellPath: string): 'bash' | 'zsh' | 'other' {
  const shellName = getShellBasename(shellPath)
  if (shellName === 'bash') return 'bash'
  if (shellName === 'zsh') return 'zsh'
  return 'other'
}

function createUnixShellIntegrationRc(
  id: string,
  shellKind: 'bash' | 'zsh',
): { env: Record<string, string>; rcFile: string; cleanup: () => void } | null {
  try {
    const home = process.env.HOME || ''
      const userRc = shellKind === 'zsh'
      ? path.join(home, '.zshrc')
      : path.join(home, '.bashrc')
    const sourceUserRc = home && fs.existsSync(userRc)
      ? `if [ -f '${userRc.replace(/'/g, `'\\''`)}' ]; then . '${userRc.replace(/'/g, `'\\''`)}'; fi\n`
      : ''
    const integration = getShellIntegrationResourcePath('shellIntegration.sh')
    const integrationLiteral = integration.replace(/'/g, `'\\''`)

    if (shellKind === 'bash') {
      const rcFile = path.join(app.getPath('temp'), `adnify-shell-integration-${id}.bashrc`)
      fs.writeFileSync(rcFile, `${sourceUserRc}. '${integrationLiteral}'\n`, { mode: 0o600 })
      return { env: {}, rcFile, cleanup: () => { try { fs.rmSync(rcFile, { force: true }) } catch { /* Temporary shell files may already have been removed. */ } } }
    }

    const zdotdir = path.join(app.getPath('temp'), `adnify-shell-integration-${id}`)
    fs.mkdirSync(zdotdir, { recursive: true })
    const rcFile = path.join(zdotdir, '.zshrc')
    fs.writeFileSync(rcFile, `${sourceUserRc}. '${integrationLiteral}'\n`, { mode: 0o600 })
    return {
      env: { ZDOTDIR: zdotdir },
      rcFile,
      cleanup: () => { try { fs.rmSync(zdotdir, { recursive: true, force: true }) } catch { /* Temporary shell files may already have been removed. */ } },
    }
  } catch {
    return null
  }
}

// dugite 在开发环境或部分系统可能缺失嵌入式二进制包
// 记录 dugite 可用性状态（null: 未探测, true: 可用, false: 不可用），避免每次重复报错与异常捕获开销
let dugiteAvailable: boolean | null = null

interface GitCommandOutcome {
  success: boolean
  stdout?: string
  stderr?: string
  exitCode?: number
  error?: string
}

/**
 * 真正执行 Git 的那一段（dugite 优先，失败回退到安全 spawn）。
 *
 * 抽出来是因为现在有两条准入路径 —— 通用的 `git:execSecure` 和车道专用的
 * `git:worktreeLane` —— 但执行、审计、非零退出码的日志分级必须是同一份。
 */
async function runGitCommand(args: string[], cwd: string): Promise<GitCommandOutcome> {
  const fullCommand = args.join(' ')

  if (dugiteAvailable !== false) {
    try {
      const result = await gitExec(args, cwd)
      dugiteAvailable = true

      securityManager.logOperation(OperationType.GIT_EXEC, fullCommand, true, {
        exitCode: result.exitCode,
      })

      if (result.exitCode !== 0) {
        // 查询型命令（rev-parse --verify, status 等）exitCode 非零是正常的，不应记为 error
        if (isExpectedGitQueryMiss(args, result.stderr || '', result.stdout || '')) {
          logger.security.debug('[Git] dugite query returned non-zero:', args)
        } else if (shouldLogGitNonZeroAsWarning(args, result.stderr || '', result.stdout || '')) {
          logger.security.warn('[Git] dugite returned expected non-zero result:', args, result.stderr || result.stdout)
        } else {
          logger.security.error('[Git] dugite exec failed:', args, result.stderr || result.stdout)
        }
      }

      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      }
    } catch (error) {
      dugiteAvailable = false
      const msg = error instanceof Error ? error.message : String(error)
      logger.security.info(`[Git] dugite 嵌入式包不可用 (${msg})，已自动切换为系统安全 spawn 模式`)
    }
  }

  try {
    // 安全回退：使用系统的 spawn 执行 git
    const result = await SecureCommandParser.executeSecureCommand('git', args, cwd, 120000)

    securityManager.logOperation(OperationType.GIT_EXEC, fullCommand, true, {
      exitCode: result.exitCode,
    })

    if (result.exitCode !== 0) {
      if (isExpectedGitQueryMiss(args, result.stderr || '', result.stdout || '')) {
        logger.security.debug('[Git] spawn query returned non-zero:', args)
      } else if (shouldLogGitNonZeroAsWarning(args, result.stderr || '', result.stdout || '')) {
        logger.security.warn('[Git] spawn returned expected non-zero result:', args, result.stderr || result.stdout)
      } else {
        logger.security.error('[Git] spawn exec failed:', args, result.stderr || result.stdout)
      }
    }

    return {
      success: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    }
  } catch (err) {
    securityManager.logOperation(OperationType.GIT_EXEC, fullCommand, false, {
      error: toAppError(err).message,
    })
    return {
      success: false,
      error: `Git execution failed: ${toAppError(err).message}`,
    }
  }
}

/**
 * 可靠地终止 PTY 进程树
 *
 * node-pty 的 ConPTY 模式在 Windows 上 kill() 存在异步竞态，
 * 可能导致 PowerShell/conhost 子进程残留。
 * 使用 taskkill /F /T 强制终止整个进程树。
 */
function killPtyReliably(ptyProcess: any): void {
  try {
    ptyProcess.removeAllListeners('exit')
    ptyProcess.removeAllListeners('data')
  } catch { /* ignore */ }

  const pid = ptyProcess.pid
  if (process.platform === 'win32' && pid) {
    // Never block Electron's main loop while Windows tears down ConPTY.
    execFile(
      'taskkill',
      ['/F', '/T', '/PID', String(pid)],
      { windowsHide: true, timeout: 5000 },
      (error) => {
        if (!error) return
        try { ptyProcess.kill() } catch { /* ignore */ }
      },
    )
    return
  }

  try { ptyProcess.kill() } catch { /* ignore */ }
}

/**
 * 清理所有终端进程
 */
export function cleanupTerminals(): void {
  for (const [id, ptyProcess] of terminals) {
    killPtyReliably(ptyProcess)
    terminals.delete(id)
  }
  // 清理后台进程
  for (const [pid, child] of backgroundProcesses) {
    try { child.kill('SIGTERM') } catch { /* ignore */ }
    backgroundProcesses.delete(pid)
  }
  // Piped agent commands are tracked by pid only; the promise that owns each
  // child is already gone by the time shutdown runs.
  for (const pid of pipedShellPids) {
    try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ }
    pipedShellPids.delete(pid)
  }
  logger.security.info(`[Terminal] All terminals and background processes cleaned up`)
}

/**
 * 安全命令解析器
 */
class SecureCommandParser {
  /**
   * 安全执行命令
   */
  static async executeSecureCommand(
    command: string,
    args: string[],
    cwd: string,
    timeout: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const isWindowsBatch = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command)
      const executable = isWindowsBatch ? (process.env.ComSpec || 'cmd.exe') : command
      const executableArgs = isWindowsBatch
        ? ['/d', '/s', '/c', 'call', command, ...args]
        : args
      // 使用 spawn 直接执行（不经过 shell），防止注入攻击
      const child = spawn(executable, executableArgs, {
        cwd,
        timeout,
        env: {
          ...process.env,
          PATH: process.env.PATH,
        },
      })

      let stdout = ''
      let stderr = ''

      // 必须用 StringDecoder：一个 UTF-8 字符可能被 spawn 切在两个 chunk 之间，
      // 直接 data.toString() 会把半个字符解成 U+FFFD，中文输出必然出现乱码。
      const stdoutDecoder = new StringDecoder('utf8')
      const stderrDecoder = new StringDecoder('utf8')

      child.stdout.on('data', (data: Buffer) => {
        stdout += stdoutDecoder.write(data)
      })

      child.stderr.on('data', (data: Buffer) => {
        stderr += stderrDecoder.write(data)
      })

      child.on('close', (code) => {
        stdout += stdoutDecoder.end()
        stderr += stderrDecoder.end()
        resolve({ stdout, stderr, exitCode: code ?? -1 })
      })

      child.on('error', (err) => {
        reject(err)
      })
    })
  }
}

function shouldLogGitNonZeroAsWarning(args: string[], stderr: string, stdout: string): boolean {  const gitSubCommand = args.find(arg => !arg.startsWith('-'))?.toLowerCase()
  const output = `${stderr}\n${stdout}`.toLowerCase()

  if (gitSubCommand === 'notes' && args.includes('show') && output.includes('no note found for object')) {
    return true
  }

  return false
}

function isExpectedGitQueryMiss(args: string[], stderr: string, stdout: string): boolean {
  const output = `${stderr}\n${stdout}`.toLowerCase()
  return args.some(arg => arg === '--verify' || arg === '--is-inside-work-tree')
    || output.includes('not a git repository')
}

/**
 * 注册安全的终端处理程序
 */
export function registerSecureTerminalHandlers(
  getMainWindow: () => BrowserWindow | null,
  getWorkspace: (event?: Electron.IpcMainInvokeEvent) => { roots: string[] } | null,
  getWindowWorkspace?: (windowId: number) => string[] | null
) {
  const authorizeDecision = async (
    operation: OperationType,
    target: string,
    decision: ExecutionDecision,
  ): Promise<{ allowed: boolean; reasons?: ExecutionReason[] }> => {
    if (decision.kind === 'deny') {
      securityManager.logOperation(operation, target, false, {
        reasons: decision.reasons.map(reason => reason.code).join(','),
        code: decision.code,
      })
      return { allowed: false, reasons: decision.reasons }
    }
    if (decision.kind === 'ask') {
      const presentation = decision.code === 'path.external' || decision.code === 'shell.critical'
        ? 'native'
        : 'app'
      const allowed = await securityManager.requestApproval(
        operation,
        target,
        decision.reasons,
        presentation,
      )
      return allowed ? { allowed: true } : { allowed: false, reasons: decision.reasons }
    }
    return { allowed: true }
  }

  const assessShellExecution = (
    command: string,
    cwd: string,
    workspace: { roots: string[] } | null,
  ): ExecutionDecision => {
    const base = assessShellCommand(command, WHITELIST.shell)
    const trustedWorkspaceOperation = base.code === 'shell.dangerous'
      && securityManager.isWorkspaceDangerousOperationTrusted(cwd, workspace?.roots || [])
    const workspaceScoped: ExecutionDecision = trustedWorkspaceOperation
      ? {
          ...base,
          kind: 'allow',
          code: 'shell.workspace-trusted',
          reasons: [{ code: 'shellWorkspaceTrusted' }],
        }
      : base
    const resolvedCwd = path.resolve(cwd)
    const outsideWorkspace = Boolean(workspace?.roots.length && !workspace.roots.some(root => {
      const relative = path.relative(path.resolve(root), resolvedCwd)
      return !relative.startsWith('..') && !path.isAbsolute(relative)
    }))
    return requireExternalPathApproval(workspaceScoped, outsideWorkspace)
  }

  const executionTarget = (command: string, cwd: string): string =>
    `${command}\n${cwd}`

  safeIpcHandle('security:authorizeCommand', async (
    event,
    request: { command: string; cwd?: string; approval?: AgentApprovalProof },
  ): Promise<{ allowed: boolean; authorizationId?: string; reasons?: ExecutionReason[]; risk?: string }> => {
    const command = typeof request?.command === 'string' ? request.command.trim() : ''
    const workspace = getWorkspace(event)
    const cwd = request?.cwd || workspace?.roots[0] || process.cwd()
    const decision = assessShellExecution(command, cwd, workspace)
    const hasDockApproval = isRecentAgentApprovalProof(
      request?.approval,
      commandApprovalScope(command, cwd),
    )
    const authorization: { allowed: boolean; reasons?: ExecutionReason[] } = decision.kind === 'ask'
      ? hasDockApproval
        ? { allowed: true }
        : { allowed: false, reasons: [{ code: 'terminalDockApprovalRequired' }] }
      : await authorizeDecision(
          OperationType.SHELL_EXECUTE,
          executionTarget(command, cwd),
          decision,
        )
    if (!authorization.allowed) {
      return { allowed: false, reasons: authorization.reasons ?? decision.reasons, risk: decision.risk }
    }
    return {
      allowed: true,
      authorizationId: issueCommandAuthorization(command, cwd),
      reasons: decision.reasons,
      risk: decision.risk,
    }
  })

  /**
   * 安全的命令执行（可信自动执行列表 + 风险审批 + 工作区边界）
   * 替代原来的 shell:execute
   */
  safeIpcHandle('shell:executeSecure', async (
    event,
    request: SecureShellRequest
  ): Promise<{
    success: boolean
    output?: string
    errorOutput?: string
    exitCode?: number
    error?: string
  }> => {
    const { command, args = [], cwd, timeout = 30000 } = request
    // 使用发起请求的窗口，确保多窗口场景下命令绑定到正确的窗口
    const mainWindow = BrowserWindow.fromWebContents(event.sender) || getMainWindow()
    const workspace = getWorkspace(event)

    if (!mainWindow || mainWindow.isDestroyed()) {
      return { success: false, error: 'Main window is not ready' }
    }

    // 1. 工作区检查（支持无工作区模式）
    let targetPath: string
    if (workspace) {
      targetPath = cwd || workspace.roots[0]
    } else {
      // 无工作区模式：使用 cwd 或当前进程工作目录
      targetPath = cwd || process.cwd()
      logger.security.info(`[Security] No workspace set, using: ${targetPath}`)
    }

    const fullCommand = [command, ...args].join(' ')
    const policyAuthorization = await authorizeDecision(
      OperationType.SHELL_EXECUTE,
      executionTarget(fullCommand, targetPath),
      assessShellExecution(fullCommand, targetPath, workspace),
    )
    if (!policyAuthorization.allowed) {
      return { success: false, error: securityManager.localizeReasons(policyAuthorization.reasons ?? []) }
    }

    try {
      // 5. 安全执行命令
      const result = await SecureCommandParser.executeSecureCommand(
        command,
        args,
        targetPath,
        timeout
      )

      // 6. 记录审计日志
      securityManager.logOperation(OperationType.SHELL_EXECUTE, fullCommand, true, {
        exitCode: result.exitCode,
        outputLength: result.stdout.length,
        errorLength: result.stderr.length,
      })

      return {
        success: result.exitCode === 0,
        output: result.stdout,
        errorOutput: result.stderr,
        exitCode: result.exitCode,
      }
    } catch (err) {
      const executionError = err as NodeJS.ErrnoException
      const errorDetail = `${executionError.code ? `[${executionError.code}] ` : ''}${executionError.message || toAppError(err).message}`
      securityManager.logOperation(OperationType.SHELL_EXECUTE, fullCommand, false, {
        error: errorDetail,
      })
      return {
        success: false,
        error: `Execution failed: ${errorDetail}`,
      }
    }
  })

  /**
   * 安全的 Git 命令执行
   * 替代原来的 git:exec（移除 exec 拼接）
   */
  safeIpcHandle('git:execSecure', async (
    event,
    args: string[],
    cwd: string
  ): Promise<{
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
  }> => {
    // 优先使用请求来源窗口的工作区（支持多窗口隔离）
    const windowId = event.sender.id
    const windowRoots = getWindowWorkspace?.(windowId)
    const workspace = windowRoots ? { roots: windowRoots } : getWorkspace()

    // 调试日志：记录 workspace 状态
    logger.security.debug('[Git] Workspace check:', {
      windowId,
      windowRoots: windowRoots || 'null',
      workspaceFromStore: workspace?.roots || 'null',
      cwd,
    })

    // 1. 工作区检查（允许无工作区模式以支持新窗口）
    if (!workspace || workspace.roots.length === 0) {
      // 无工作区时信任传入的cwd路径
      logger.security.info('[Git] No workspace set, trusting cwd:', cwd)
    }

    const fullCommand = args.join(' ')
    const outsideWorkspace = Boolean(
      workspace?.roots.length
      && !securityManager.validateWorkspacePath(cwd, workspace.roots),
    )
    const policyAuthorization = await authorizeDecision(
      OperationType.GIT_EXEC,
      executionTarget(`git ${fullCommand}`, cwd),
      requireExternalPathApproval(assessGitCommand(args, WHITELIST.git), outsideWorkspace),
    )
    if (!policyAuthorization.allowed) {
      return { success: false, error: securityManager.localizeReasons(policyAuthorization.reasons ?? []) }
    }

    // 5. 执行 Git 命令（优先 dugite，若已探测不可用则直接使用系统安全的 spawn）
    return await runGitCommand(args, cwd)
  })

  /**
   * 车道专用 Git 通道：只放开被 worktreeLanePolicy 严格限定的 worktree 操作。
   *
   * 通用通道会把 `worktree` 当作不可信子命令而弹审批，但车道是后台执行节点在
   * 创建/回收，弹框只会打断用户；把 `worktree` 放进全局白名单又会顺带允许把检出
   * 写到工作区外面。这条通道两头都不选：形状固定、目标限定在
   * `<工作区根>/.adnify/worktrees/` 之内，越界一律拒绝。
   */
  safeIpcHandle('git:worktreeLane', async (
    event,
    args: string[],
    cwd: string
  ): Promise<{
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
  }> => {
    const windowId = event.sender.id
    const windowRoots = getWindowWorkspace?.(windowId)
    const workspace = windowRoots ? { roots: windowRoots } : getWorkspace()
    const roots = workspace?.roots || []

    const decision = assessWorktreeLaneCommand(args, cwd, roots)
    if (!decision.allowed) {
      securityManager.logOperation(OperationType.GIT_EXEC, `git ${args.join(' ')}`, false, {
        reason: decision.reason,
        code: 'git.worktree-lane',
      })
      return { success: false, error: decision.reason }
    }

    // 中文路径在 worktree list --porcelain 里会被转义，统一关掉 quotePath。
    return await runGitCommand(['--no-optional-locks', '-c', 'core.quotePath=false', ...args], cwd)
  })

  // ============ Interactive Terminal with node-pty ============

  const MAX_TERMINALS = 10 // 最大终端数量限制
  let pty: any = null

  // Try to load node-pty
  try {
    pty = require('node-pty')

    // 验证 node-pty 是否可用
    try {
      // 只验证模块加载，不实际创建进程
      if (typeof pty.spawn !== 'function') {
        throw new Error('node-pty.spawn is not a function')
      }
      logger.security.info('[Terminal] node-pty loaded and verified successfully')
    } catch (err) {
      logger.security.error('[Terminal] node-pty verification failed:', err)
      logger.security.error('[Terminal] This usually means node-pty needs to be rebuilt for Electron.')
      logger.security.error('[Terminal] Please run: npm run rebuild')
      pty = null
    }
  } catch (err) {
    const errorMsg = toAppError(err).message || toAppError(err).message || 'Unknown error'
    logger.security.warn('[Terminal] node-pty not available, interactive terminal disabled')
    logger.security.warn('[Terminal] Error:', errorMsg)

    // 检查是否是原生模块加载错误
    if (errorMsg.includes('Cannot find module') || errorMsg.includes('module') || errorMsg.includes('native')) {
      logger.security.error('[Terminal] node-pty native module may need to be rebuilt.')
      logger.security.error('[Terminal] Please run: npm run rebuild')
    }

    pty = null
  }

  type TerminalBackend = 'pty' | 'pipe'

  class PipeShellSession extends EventEmitter {
    private readonly stdoutUtf8 = new StringDecoder('utf8')
    private readonly stderrUtf8 = new StringDecoder('utf8')

    constructor(private readonly child: ChildProcessWithoutNullStreams) {
      super()

      this.child.stdout.on('data', (data: Buffer) => {
        const text = this.stdoutUtf8.write(data)
        if (text.length > 0) {
          this.emit('data', text)
        }
      })

      this.child.stderr.on('data', (data: Buffer) => {
        const text = this.stderrUtf8.write(data)
        if (text.length > 0) {
          this.emit('data', text)
        }
      })

      this.child.on('error', (err) => {
        this.emit('error', err)
      })

      this.child.on('close', (code) => {
        const tailOut = this.stdoutUtf8.end()
        const tailErr = this.stderrUtf8.end()
        if (tailOut.length > 0) {
          this.emit('data', tailOut)
        }
        if (tailErr.length > 0) {
          this.emit('data', tailErr)
        }
        this.emit('exit', { exitCode: code ?? 0 })
      })
    }

    onData(listener: (data: string) => void) {
      this.on('data', listener)
      return this
    }

    onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
      this.on('exit', listener)
      return this
    }

    write(data: string) {
      if (data === String.fromCharCode(3)) {
        this.kill('SIGINT')
        return
      }

      if (!this.child.stdin.destroyed) {
        this.child.stdin.write(normalizePipeTerminalInput(data))
      }
    }

    resize(_cols: number, _rows: number) {
      // Pipe-backed sessions do not support PTY resizing.
    }

    kill(signal: NodeJS.Signals = 'SIGTERM') {
      if (this.child.killed) {
        return
      }

      if (process.platform !== 'win32' && this.child.pid) {
        try {
          process.kill(-this.child.pid, signal)
          return
        } catch {
          // Fall back to killing the shell process directly.
        }
      }

      this.child.kill(signal)
    }
  }

  let ssh2ClientCtor: any = null

  const getSsh2ClientCtor = () => {
    if (ssh2ClientCtor) return ssh2ClientCtor

    try {
      const cpuFeaturesPath = require.resolve('cpu-features')
      require.cache[cpuFeaturesPath] = {
        id: cpuFeaturesPath,
        filename: cpuFeaturesPath,
        loaded: true,
        exports: () => null,
        children: [],
        paths: [],
      } as unknown as NodeJS.Module
    } catch { /* cpu-features is optional; ssh2 can use its JavaScript fallback. */
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires -- Load ssh2 after configuring its optional native dependency.
    ssh2ClientCtor = require('ssh2').Client
    return ssh2ClientCtor
  }

  class SshShellSession extends EventEmitter {
    private connection: any
    private stream: any
    private closed = false
    private cols: number
    private rows: number
    private readonly streamUtf8 = new StringDecoder('utf8')
    private integrationCommand: string | null = null

    constructor(private readonly server: { host: string; port?: number; username?: string; password?: string; privateKeyPath?: string; remotePath?: string; shell?: string }, cols = 80, rows = 24) {
      super()
      this.cols = cols
      this.rows = rows
      this.connection = null
      this.stream = null
    }

    async connect(): Promise<void> {
      const Client = getSsh2ClientCtor()
      this.connection = new Client()

      const config: Record<string, unknown> & {
        hostVerifier?: (key: Buffer, callback: (trusted: boolean) => void) => void
      } = {
        host: this.server.host.trim(),
        port: this.server.port && this.server.port > 0 ? this.server.port : 22,
        username: this.server.username?.trim() || 'root',
        readyTimeout: 15000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
        tryKeyboard: Boolean(this.server.password),
      }

      if (this.server.privateKeyPath?.trim()) {
        config.privateKey = fs.readFileSync(this.server.privateKeyPath.trim(), 'utf8')
      }
      if (this.server.password?.trim()) {
        config.password = this.server.password
      }

      await new Promise<void>((resolve, reject) => {
        let settled = false
        let verificationError: Error | null = null
        const finishReject = (error: unknown) => {
          if (settled) return
          settled = true
          reject(error)
        }

        config.hostVerifier = (key: Buffer, callback: (trusted: boolean) => void) => {
          remoteHostTrustService.verifyOrRecordHost({
            host: String(config.host),
            port: Number(config.port),
            publicKey: key,
          }).then(() => {
            callback(true)
          }).catch((error) => {
            verificationError = error instanceof Error ? error : new Error(String(error))
            callback(false)
          })
        }

        this.connection
          .on('ready', () => {
            this.connection.shell({ term: 'xterm-256color', cols: this.cols, rows: this.rows }, (error: Error | undefined, stream: any) => {
              if (error || !stream) {
                finishReject(error || new Error('Failed to open remote shell'))
                return
              }

              this.stream = stream
              stream.on('data', (data: Buffer | string) => {
                if (typeof data === 'string') {
                  this.emit('data', data)
                  return
                }
                const text = this.streamUtf8.write(data)
                if (text.length > 0) {
                  this.emit('data', text)
                }
              })
              stream.on('close', () => {
                if (this.closed) return
                this.closed = true
                const tail = this.streamUtf8.end()
                if (tail.length > 0) {
                  this.emit('data', tail)
                }
                this.emit('exit', { exitCode: 0 })
                this.connection.end()
              })
              stream.on('error', (err: unknown) => this.emit('error', err))

              if (this.server.remotePath?.trim()) {
                const escaped = this.server.remotePath.trim().replace(/'/g, `'\\''`)
                stream.write(`cd '${escaped}'\n`)
              }

              const finish = () => {
                if (settled) return
                settled = true
                resolve()
              }

              this.detectRemoteLoginShell()
                .then(async shell => {
                  await this.uploadShellIntegration(stream, shell)
                  finish()
                })
                .catch(error => {
                  // Shell start-up must never fail because integration is
                  // unavailable. The terminal remains usable in fallback mode.
                  logger.security.warn('[Terminal] Remote shell integration unavailable:', error)
                  finish()
                })
            })
          })
          .on('keyboard-interactive', (_name: string, _instructions: string, _lang: string, _prompts: Array<unknown>, finish: (responses: string[]) => void) => {
            finish([this.server.password || ''])
          })
          .on('error', (error: unknown) => {
            const effectiveError = verificationError || error
            this.emit('error', effectiveError)
            finishReject(effectiveError)
          })
          .on('close', () => {
            if (this.closed) return
            this.closed = true
            const tail = this.streamUtf8.end()
            if (tail.length > 0) {
              this.emit('data', tail)
            }
            this.emit('exit', { exitCode: 0 })
          })
          .connect(config as any)
      })
    }

    private async detectRemoteLoginShell(): Promise<string> {
      const command = `getent passwd "$(id -un)" 2>/dev/null | cut -d: -f7`
      return await new Promise<string>((resolve, reject) => {
        this.connection.exec(command, (error: Error | undefined, channel: any) => {
          if (error || !channel) {
            reject(error || new Error('Failed to inspect remote login shell'))
            return
          }

          let output = ''
          let stderr = ''
          channel.on('data', (data: Buffer) => { output += data.toString('utf8') })
          channel.on('stderr', (data: Buffer) => { stderr += data.toString('utf8') })
          channel.on('close', (code: number) => {
            const shell = output.trim().split('\n')[0] || ''
            if (code === 0 && shell) resolve(shell)
            else reject(new Error(stderr.trim() || `Failed to inspect remote login shell (exit ${code})`))
          })
          channel.on('error', reject)
        })
      })
    }

    private async uploadShellIntegration(stream: any, shellPath: string): Promise<void> {
      const shellKind = getUnixShellKind(shellPath)
      if (shellKind === 'other') return

      const scriptPath = getShellIntegrationResourcePath('shellIntegration.sh')
      const contents = await new Promise<Buffer>((resolve, reject) => {
        fs.readFile(scriptPath, (error: NodeJS.ErrnoException | null, data: Buffer) => {
          if (error) reject(error)
          else resolve(data)
        })
      })
      const remoteScript = `.adnify-shell-integration-${process.pid}-${Date.now()}.sh`
      const sftp = await new Promise<any>((resolve, reject) => {
        this.connection.sftp((error: Error | undefined, client: any) => {
          if (error || !client) reject(error || new Error('Failed to open SFTP subsystem'))
          else resolve(client)
        })
      })

      try {
        await new Promise<void>((resolve, reject) => {
          sftp.writeFile(remoteScript, contents, { mode: 0o600 }, (error: Error | null | undefined) => {
            if (error) reject(error)
            else resolve()
          })
        })
      } finally {
        sftp.end()
      }

      const literalPath = remoteScript.replace(/'/g, `'\\''`)
      this.integrationCommand = `. './${literalPath}' && rm -f './${literalPath}'`
      stream.write(`${this.integrationCommand}\n`)
    }

    onData(listener: (data: string) => void) {
      this.on('data', listener)
      return this
    }

    onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
      this.on('exit', listener)
      return this
    }

    write(data: string) {
      if (this.stream) {
        this.stream.write(data)
      }
    }

    resize(cols: number, rows: number) {
      this.cols = cols
      this.rows = rows
      try {
        this.stream?.setWindow(rows, cols, 0, 0)
      } catch { /* The remote terminal may already be closed during a resize. */
      }
    }

    kill() {
      if (this.closed) return
      this.closed = true
      const tail = this.streamUtf8.end()
      if (tail.length > 0) {
        this.emit('data', tail)
      }
      try {
        this.stream?.end('exit\n')
      } catch { /* Continue cleanup if the remote stream has already closed. */
      }
      try {
        this.connection?.end()
      } catch { /* Still emit the local exit event if the SSH connection is closed. */
      }
      this.emit('exit', { exitCode: 0 })
    }
  }

  const bindTerminalProcess = (id: string, terminalProcess: any, mainWindow: BrowserWindow | null) => {
    terminals.set(id, terminalProcess)
    let seq = 0
    const ptyUtf8 = new StringDecoder('utf8')

    const nextMeta = () => ({
      seq: ++seq,
      occurredAt: Date.now(),
    })

    /**
     * PTY 输出批处理。
     *
     * 构建/安装类命令会以极高频率吐数据，逐块 webContents.send 会让
     * 每个 chunk 都付一次 IPC + 结构化克隆 + renderer 渲染的代价。
     * 这里按 ~16ms 合并为一次发送。
     *
     * 用节流而非防抖：持续输出的命令（如 npm install）在防抖下会被
     * 一直推迟，直到输出停顿才刷新，表现为终端长时间空白后突然刷屏。
     * 节流保证首块立即送达，之后稳定按帧率输出。
     *
     * 实现来自 @shared/utils/keyedLeadingEdgeThrottle——原来这里内联了一份，
     * 且是后沿的（首块也要等满 16ms）。LLM 流式事件那边踩的是同一个坑，现在
     * 两边共用一份带不变量测试的实现。
     */
    const PTY_FLUSH_INTERVAL_MS = 16

    const ptyPacer = createKeyedLeadingEdgeThrottle<string, string>({
      intervalMs: PTY_FLUSH_INTERVAL_MS,
      accumulate: (pending, next) => (pending ?? '') + next,
      emit: (terminalId, data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('terminal:data', { id: terminalId, data, ...nextMeta() })
        }
      },
      onEmitError: (error, terminalId) => {
        logger.security.error(`[Terminal] Failed to send PTY data (id: ${terminalId}):`, error)
      },
    })

    terminalProcess.onData((data: string | Buffer) => {
      const text = typeof data === 'string' ? data : ptyUtf8.write(data)
      if (text.length === 0) {
        return
      }
      ptyPacer.push(id, text)
    })

    terminalProcess.on('error', (err: any) => {
      logger.security.error(`[Terminal] PTY Error (id: ${id}):`, err)
      // 先刷出已缓冲的输出，错误信息才不会跑到它前面
      ptyPacer.flush(id)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:error', {
          id,
          error: toAppError(err).message,
          fatal: true,
          reason: 'process_error',
          ...nextMeta(),
        })
      }
    })

    terminalProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
      logger.security.info(`[Terminal] Terminal ${id} exited with code ${exitCode}, signal ${signal}`)
      terminals.delete(id)
      // 解码残留字节并入缓冲，再整体刷出，保证退出前不丢输出且顺序正确
      const tail = ptyUtf8.end()
      if (tail.length > 0) {
        ptyPacer.push(id, tail)
      }
      ptyPacer.flush(id)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:exit', {
          id,
          exitCode,
          signal,
          reason: 'process_exit',
          ...nextMeta(),
        })
      }
    })
  }

  /**
   * 交互式终端创建（默认 node-pty；渲染进程为 Agent 终端传入 pipe 时可退回 pipe 会话）
   */
  type InteractiveTerminalOptions = {
    id: string
    cwd?: string
    shell?: string
    backend?: TerminalBackend
    remote?: {
      host: string
      port?: number
      username?: string
      password?: string
      privateKeyPath?: string
      remotePath?: string
      shell?: string
    }
    isAgent?: boolean
  }

  safeIpcHandle('terminal:interactive', async (
    event,
    options: InteractiveTerminalOptions
  ) => {
    // 使用发起请求的窗口，而非全局最后活跃窗口，确保多窗口场景下终端绑定到正确的窗口
    const mainWindow = BrowserWindow.fromWebContents(event.sender) || getMainWindow()
    const workspace = getWorkspace(event)
    const { id, cwd, shell, remote } = options
    const backend = options.backend ?? (process.platform === 'darwin' ? 'pipe' : 'pty')
    const effectiveBackend: TerminalBackend = backend

    if (effectiveBackend === 'pty' && !pty) {
      return { success: false, error: 'node-pty not available' }
    }

    if (terminals.size >= MAX_TERMINALS && !terminals.has(id)) {
      return { success: false, error: `Maximum number of terminals (${MAX_TERMINALS}) reached` }
    }

    const fallbackCwd = workspace?.roots?.[0] || process.cwd()
    const targetCwd = remote?.host
      ? fallbackCwd
      : ((cwd && cwd.trim()) || fallbackCwd)

    if (workspace && workspace.roots.length > 0 && !remote?.host && !securityManager.validateWorkspacePath(targetCwd, workspace.roots)) {
      securityManager.logOperation(OperationType.TERMINAL_INTERACTIVE, 'terminal:create', false, {
        reason: 'cwd outside workspace',
        cwd: targetCwd,
      })
      return { success: false, error: 'Terminals can only be created inside the workspace' }
    }

    try {
      const isWindows = process.platform === 'win32'
      const isMac = process.platform === 'darwin'

      let shellPath: string
      let shellArgs: string[] = []

      if (shell) {
        shellPath = shell
      } else if (isWindows) {
        shellPath = 'powershell.exe'
      } else if (isMac) {
        const possibleShells = [
          process.env.SHELL,
          '/bin/zsh',
          '/bin/bash',
          '/usr/bin/zsh',
          '/usr/bin/bash',
        ].filter(Boolean) as string[]

        shellPath = possibleShells.find(s => {
          try {
            return fs.existsSync(s)
          } catch {
            return false
          }
        }) || '/bin/bash'

        logger.security.info(`[Terminal] Using shell: ${shellPath}`)
        shellArgs = effectiveBackend === 'pipe' ? ['-il'] : ['-l']
      } else {
        shellPath = process.env.SHELL || '/bin/bash'
      }
      const shellName = getShellBasename(shellPath)

      if (isWindows) {
        if (shellName === 'powershell.exe' || shellName === 'powershell' || shellName === 'pwsh.exe' || shellName === 'pwsh') {
          shellArgs = ['-NoLogo', '-NoExit', '-Command', getPowerShellIntegrationCommand()]
        } else if (shellName === 'cmd.exe' || shellName === 'cmd') {
          shellArgs = ['/K', 'chcp 65001 > nul']
        }
      } else if (shellName === 'bash' || shellName === 'zsh') {
        shellArgs = ['-i']
      }

      logger.security.info(`[Terminal] Spawning ${effectiveBackend.toUpperCase()} terminal: ${shellPath} ${shellArgs.join(' ')} in ${targetCwd}`)

      if (path.isAbsolute(shellPath) && !fs.existsSync(shellPath)) {
        const error = `Shell not found: ${shellPath}`
        logger.security.error(`[Terminal] ${error}`)
        return { success: false, error }
      }

      if (!remote?.host && !fs.existsSync(targetCwd)) {
        const error = `Working directory not found: ${targetCwd}`
        logger.security.error(`[Terminal] ${error}`)
        return { success: false, error }
      }

      let terminalProcess: any
      let unixIntegrationRc: ReturnType<typeof createUnixShellIntegrationRc> = null
      const shellKind = getUnixShellKind(shellPath)
      const spawnEnv = () => ({
        ...process.env,
        ...(unixIntegrationRc?.env || {}),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      })

      if (!remote?.host && !isWindows && (shellKind === 'bash' || shellKind === 'zsh')) {
        // bash supports --rcfile directly. zsh does not, so point ZDOTDIR at a
        // temporary .zshrc that first sources the user's real configuration.
        unixIntegrationRc = createUnixShellIntegrationRc(id, shellKind)
        if (unixIntegrationRc && shellKind === 'bash') {
          shellArgs = [...shellArgs, '--rcfile', unixIntegrationRc.rcFile]
        }
      }

      if (remote?.host) {
        try {
          const session = new SshShellSession({ ...remote, shell })
          await session.connect()
          terminalProcess = session
        } catch (err) {
          const errorMsg = toAppError(err).message || 'Failed to connect remote shell'
          logger.security.error(`[Terminal] Remote SSH spawn failed: ${errorMsg}`, err)
          return { success: false, error: `Failed to connect remote shell: ${errorMsg}` }
        }
      } else if (effectiveBackend === 'pipe') {
        const child = spawn(shellPath, shellArgs, {
          cwd: targetCwd,
          env: spawnEnv(),
          stdio: 'pipe',
          detached: process.platform !== 'win32',
          windowsHide: true,
        }) as ChildProcessWithoutNullStreams

        terminalProcess = new PipeShellSession(child)
      } else {
        try {
          await new Promise<void>((resolve, reject) => {
            setImmediate(() => {
              try {
                terminalProcess = pty.spawn(shellPath, shellArgs, {
                  name: 'xterm-256color',
                  cols: 80,
                  rows: 24,
                  cwd: targetCwd,
                  env: spawnEnv(),
                })

                if (!terminalProcess) {
                  reject(new Error('PTY process is null after spawn'))
                  return
                }

                resolve()
              } catch (err) {
                reject(err)
              }
            })
          })
        } catch (err) {
          const errorMsg = toAppError(err).message || toAppError(err).message || 'Unknown spawn error'
          logger.security.error(`[Terminal] PTY spawn failed: ${errorMsg}`, err)

          if (errorMsg.includes('Napi::Error') || errorMsg.includes('native') || errorMsg.includes('module') || errorMsg.includes('libc++abi')) {
            return {
              success: false,
              error: 'node-pty native module error. The module may need to be rebuilt for this Electron version. Please run: npm run rebuild'
            }
          }

          return { success: false, error: `Failed to spawn terminal: ${errorMsg}` }
        }
      }

      bindTerminalProcess(id, terminalProcess, mainWindow)
      if (unixIntegrationRc) {
        // The rc file only needs to survive shell start-up. SFTP and zsh
        // environments may hold a handle briefly, so removal is deliberately
        // deferred and failure is harmless.
        setTimeout(() => unixIntegrationRc.cleanup(), 30_000)
      }

      // PTY 输出统一按 UTF-8 解码（bindTerminalProcess 里的 StringDecoder），
      // 但 Windows 控制台默认代码页是本地化的（简中为 GBK/936），PowerShell
      // 会按该代码页输出字节 → 被当成 UTF-8 解码就是乱码。
      // 这里在任何命令执行前把会话切到 UTF-8，让两端一致。
      // 注意：只对本地 Windows PTY 生效；SSH/pipe 会话不适用。
      securityManager.logOperation(OperationType.TERMINAL_INTERACTIVE, 'terminal:create', true, {
        id,
        cwd: targetCwd,
        shell: shellPath,
        backend: remote?.host ? 'ssh2' : effectiveBackend,
        remoteHost: remote?.host,
      })

      logger.security.info(`[Terminal] Created ${remote?.host ? 'ssh2' : effectiveBackend} terminal ${id} with shell ${shellPath}`)
      return { success: true }
    } catch (err) {
      logger.security.error('[Terminal] Failed to create terminal:', err)
      return { success: false, error: toAppError(err).message }
    }
  })

  /**
   * 获取可用 shell 列表（通过命令检测）
   */
  safeIpcHandle('shell:getAvailableShells', async () => {
    const shells: { label: string; path: string }[] = []
    const isWindows = process.platform === 'win32'

    // 异步检查命令是否可执行
    const canExecute = async (cmd: string): Promise<boolean> => {
      try {
        await execFileAsync(cmd, ['--version'], {
          encoding: 'utf-8',
          timeout: 3000,
          windowsHide: true,
        })
        return true
      } catch {
        return false
      }
    }

    if (isWindows) {
      // PowerShell (always available)
      shells.push({ label: 'PowerShell', path: 'powershell.exe' })

      // Command Prompt (always available)
      shells.push({ label: 'Command Prompt', path: 'cmd.exe' })

      // Git Bash - 通过 git --exec-path 动态获取
      try {
        const { stdout } = await execFileAsync('git', ['--exec-path'], {
          encoding: 'utf-8',
          windowsHide: true,
        })
        const gitExecPath = stdout.trim()
        if (gitExecPath) {
          const gitRoot = path.resolve(gitExecPath, '..', '..', '..')
          const bashPath = path.join(gitRoot, 'bin', 'bash.exe')
          if (fs.existsSync(bashPath)) {
            shells.push({ label: 'Git Bash', path: bashPath })
          }
        }
      } catch {
        // Git 不可用
      }

      // 并行检测 WSL 和 PowerShell Core
      const [hasWsl, hasPwsh] = await Promise.all([canExecute('wsl'), canExecute('pwsh')])
      if (hasWsl) shells.push({ label: 'WSL', path: 'wsl.exe' })
      if (hasPwsh) shells.push({ label: 'PowerShell Core', path: 'pwsh.exe' })
    } else {
      // Unix: detect common shells (并行检测)
      const unixShells = ['bash', 'zsh', 'fish']
      const results = await Promise.all(unixShells.map(async (sh) => {
        try {
          const { stdout } = await execFileAsync('which', [sh], {
            encoding: 'utf-8',
            windowsHide: true,
          })
          const path = stdout.trim()
          if (path) return { label: sh.charAt(0).toUpperCase() + sh.slice(1), path }
        } catch { /* not found */ }
        return null
      }))
      for (const result of results) {
        if (result) shells.push(result)
      }
    }

    logger.security.info('[Terminal] Available shells:', shells.map(s => s.label).join(', '))
    return shells
  })

  /**
   * Write input to terminal
   */
  safeIpcHandle('terminal:input', async (_, { id, data }: { id: string; data: string }) => {
    const ptyProcess = terminals.get(id)
    if (ptyProcess) {
      try {
        ptyProcess.write(data)

        // 对于 Ctrl+C，添加日志以便调试
        if (data === '\x03' || data === String.fromCharCode(3)) {
          logger.security.debug(`[Terminal] Ctrl+C sent to terminal ${id}`)
        }
      } catch (err) {
        logger.security.error(`[Terminal] Write error (id: ${id}):`, err)
      }
    }
  })

  /**
   * 后台执行命令（Agent 专用）
   * 使用 child_process.spawn，不依赖 PTY
   * 实时推送输出到前端，精确捕获 exit code
   */
  /**
   * Run an agent command through pipes instead of the interactive PTY.
   *
   * Reached only when terminal shell integration cannot frame the command. The
   * renderer passes a one-use authorization minted by the same policy preflight;
   * a missing, expired, reused, or mismatched token triggers a fresh decision.
   */
  safeIpcHandle('shell:runPiped', async (
    event,
    request: PipedShellRequest,
  ): Promise<PipedShellResult> => {
    const { command, cwd, timeout = 120_000, shell: customShell, maxOutputChars = 120_000, authorizationId } = request || {}
    const fail = (error: string): PipedShellResult => ({
      success: false,
      stdout: '',
      stderr: '',
      exitCode: null,
      signal: null,
      timedOut: false,
      truncated: false,
      durationMs: 0,
      error,
    })

    if (typeof command !== 'string' || !command.trim()) {
      return fail('No command provided')
    }

    const workspace = getWorkspace(event)
    const workingDir = cwd || workspace?.roots[0] || process.cwd()

    if (!consumeCommandAuthorization(authorizationId, command, workingDir)) {
      if (authorizationId) {
        return fail('Command authorization is expired, reused, or does not match the requested command')
      }
      const policyAuthorization = await authorizeDecision(
        OperationType.SHELL_EXECUTE,
        executionTarget(command, workingDir),
        assessShellExecution(command, workingDir, workspace),
      )
      if (!policyAuthorization.allowed) {
        return fail(securityManager.localizeReasons(policyAuthorization.reasons ?? []) || 'Command was not approved')
      }
    }

    const outcome = await runPipedShellCommand({
      command,
      cwd: workingDir,
      timeoutMs: timeout,
      shell: customShell,
      maxOutputChars,
      onSpawn: pid => pipedShellPids.add(pid),
      onExit: pid => pipedShellPids.delete(pid),
    })

    securityManager.logOperation(OperationType.SHELL_EXECUTE, command, outcome.exitCode === 0, {
      source: 'runPiped',
      exitCode: outcome.exitCode,
      timedOut: outcome.timedOut,
      durationMs: outcome.durationMs,
    })

    return {
      success: outcome.exitCode === 0 && !outcome.timedOut,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut: outcome.timedOut,
      truncated: outcome.truncated,
      durationMs: outcome.durationMs,
      error: outcome.error,
    }
  })

  safeIpcHandle('shell:executeBackground', async (
    event,
    { command, cwd, timeout = 30000, shell: customShell }: {
      command: string
      cwd?: string
      timeout?: number
      shell?: string
    }
  ): Promise<{ success: boolean; output: string; exitCode: number; error?: string }> => {
    // 使用发起请求的窗口，确保多窗口场景下输出推送到正确的窗口
    const mainWindow = BrowserWindow.fromWebContents(event.sender) || getMainWindow()
    const workspace = getWorkspace(event)
    const workingDir = cwd || workspace?.roots[0] || process.cwd()

    const policyAuthorization = await authorizeDecision(
      OperationType.SHELL_EXECUTE,
      executionTarget(command, workingDir),
      assessShellExecution(command, workingDir, workspace),
    )
    if (!policyAuthorization.allowed) {
      return {
        success: false,
        output: '',
        exitCode: 1,
        error: securityManager.localizeReasons(policyAuthorization.reasons ?? []),
      }
    }

    return new Promise((resolve) => {
      const isWindows = process.platform === 'win32'
      const shell = customShell || (isWindows ? 'powershell.exe' : '/bin/bash')
      const shellName = path.basename(shell).toLowerCase()
      const isPowerShell = isWindows && (
        shellName === 'powershell.exe' || shellName === 'powershell' ||
        shellName === 'pwsh.exe' || shellName === 'pwsh'
      )
      const isCmd = isWindows && (shellName === 'cmd.exe' || shellName === 'cmd')
      const utf8Command = isPowerShell
        ? `$__adnifyUtf8 = New-Object System.Text.UTF8Encoding($false); $OutputEncoding = $__adnifyUtf8; [Console]::InputEncoding = $__adnifyUtf8; [Console]::OutputEncoding = $__adnifyUtf8; ${command}`
        : command
      const shellArgs = isPowerShell
        ? ['-NoProfile', '-NoLogo', '-Command', utf8Command]
        : isCmd
          ? ['/D', '/S', '/C', `chcp 65001 > nul & ${command}`]
          : ['-c', command]

      logger.security.info(`[Shell] Executing: ${command} in ${workingDir}`)

      const child = spawn(shell, shellArgs, {
        cwd: workingDir,
        env: { ...process.env, TERM: 'dumb' },
        windowsHide: true,
      })

      // 追踪后台进程，以便应用退出时清理
      if (child.pid) backgroundProcesses.set(child.pid, child)

      let stdout = ''
      let stderr = ''
      let timedOut = false

      // 超时处理
      const timeoutId = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        // Windows 上 SIGTERM 可能不够，延迟后强制 kill
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL')
          }
        }, 1000)
      }, timeout)

      // 实时推送输出
      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        stdout += text
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('shell:output', {
            command,
            type: 'stdout',
            data: text,
            timestamp: Date.now()
          })
        }
      })

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        stderr += text
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('shell:output', {
            command,
            type: 'stderr',
            data: text,
            timestamp: Date.now()
          })
        }
      })

      child.on('close', (code, signal) => {
        clearTimeout(timeoutId)
        if (child.pid) backgroundProcesses.delete(child.pid)

        // 清理输出（移除 ANSI 序列）
        const cleanOutput = (stdout + (stderr ? `\n${stderr}` : ''))
          // eslint-disable-next-line no-control-regex -- Intentionally match protocol/control bytes for terminal handling or input sanitization.
          .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
          .replace(/\r\n/g, '\n')
          .trim()

        logger.security.info(`[Shell] Command finished: exit=${code}, signal=${signal}`)

        if (timedOut) {
          resolve({
            success: false,
            output: cleanOutput || `Command timed out after ${timeout / 1000}s`,
            exitCode: code ?? 124, // 124 是 timeout 的标准退出码
            error: `Command timed out after ${timeout / 1000}s`
          })
        } else {
          resolve({
            success: code === 0,
            output: cleanOutput,
            exitCode: code ?? 0,
          })
        }
      })

      child.on('error', (err) => {
        clearTimeout(timeoutId)
        if (child.pid) backgroundProcesses.delete(child.pid)
        logger.security.error(`[Shell] Command error:`, err)
        resolve({
          success: false,
          output: stdout + stderr,
          exitCode: 1,
          error: toAppError(err).message
        })
      })
    })
  })

  /**
   * Resize terminal
   */
  safeIpcHandle('terminal:resize', async (_, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    const ptyProcess = terminals.get(id)
    if (ptyProcess) {
      try {
        ptyProcess.resize(cols, rows)
      } catch (e) {
        // Ignore resize errors
      }
    }
  })

  /**
   * Kill terminal
   */
  ipcMain.on('terminal:kill', (_, id?: string) => {
    if (id) {
      const ptyProcess = terminals.get(id)
      if (ptyProcess) {
        killPtyReliably(ptyProcess)
        terminals.delete(id)
      }
    } else {
      // Kill all terminals
      for (const [termId, ptyProcess] of terminals) {
        killPtyReliably(ptyProcess)
        terminals.delete(termId)
      }
    }
  })
}
