/**
 * 执行准入策略：shell 命令、Git 命令、路径越界的风险判定。
 *
 * 判定结果里的 `reasons` 是原因码，不是句子。这个模块两个进程都在用，两边都没有
 * "当前界面语言"：主进程的语言是渲染进程异步同步过来的，渲染进程的语言在 store 里。
 * 所以在这里拼句子的唯一结局是拼中文，再让消费方按分类码反查英文 —— 之前就是这样，
 * 而分类码比原因粗得多（`shell.dangerous` 一个码盖了删文件、提权、改权限、跑网络脚本
 * 等七条规则），英文版只能退化成"该命令执行了破坏性操作"这种什么都没说的句子。
 *
 * 现在文案只在渲染点取一次：`securityReasonText()`。
 */
export type ExecutionDecisionKind = 'allow' | 'ask' | 'deny'
export type ExecutionRisk = 'safe' | 'elevated' | 'dangerous' | 'blocked'

/**
 * 审批原因码。
 *
 * 与 `ExecutionDecision.code` 的区别：`code` 是分类，决定弹框形态和工作区信任判断；
 * 这里的码是"到底哪条规则命中了"，只用来出文案，所以粒度细得多。
 */
export type ExecutionReasonCode =
  // shell：结构与可信列表
  | 'shellEmpty'
  | 'shellUnparsed'
  | 'shellUntrusted'
  | 'shellTrusted'
  | 'shellWorkspaceTrusted'
  // shell：不可逆的系统级操作
  | 'shellRmRoot'
  | 'shellFormatDisk'
  | 'shellBlockDevice'
  | 'shellSystemConfig'
  // shell：破坏性或提权操作
  | 'shellDeleteFiles'
  | 'shellElevate'
  | 'shellSystemState'
  | 'shellPermissions'
  | 'shellRemoteScript'
  | 'shellEncodedPowerShell'
  | 'shellSubstitution'
  // git
  | 'gitInvalid'
  | 'gitUntrusted'
  | 'gitTrusted'
  | 'gitHardReset'
  | 'gitClean'
  | 'gitForcePush'
  | 'gitBranchDelete'
  | 'gitGlobalConfig'
  | 'gitCheckoutOverwrite'
  // 路径与文件
  | 'pathExternal'
  | 'fileSensitivePath'
  | 'fileDeleteIrreversible'
  | 'fileCriticalConfig'
  | 'fileLargeDirectory'
  // 终端通道
  | 'terminalDockApprovalRequired'

export interface ExecutionReason {
  code: ExecutionReasonCode
  /** 只放可序列化的值：这个结构要过 IPC */
  params?: Record<string, string | number>
}

export interface ExecutionDecision {
  kind: ExecutionDecisionKind
  risk: ExecutionRisk
  /** 分类码：决定审批弹框形态与工作区信任判断，不是文案 */
  code: string
  /** 给用户看的原因，按顺序拼成一句（见 `securityReasonText`） */
  reasons: ExecutionReason[]
}

export interface AgentApprovalProof {
  requestId: string
  toolCallId: string
  approvedAt: number
  scope: string
}

export interface AppSecurityApprovalRequest {
  requestId: string
  operation: string
  target: string
  reasons: ExecutionReason[]
}

function normalizeApprovalPath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

export function commandApprovalScope(command: string, cwd: string): string {
  return `command:${normalizeApprovalPath(cwd)}:${command.trim()}`
}

export function fileApprovalScope(filePath: string, access: 'read' | 'write' | 'manage'): string {
  return `file:${access}:${normalizeApprovalPath(filePath)}`
}

export function isRecentAgentApprovalProof(value: unknown, expectedScope?: string, now = Date.now()): value is AgentApprovalProof {
  if (!value || typeof value !== 'object') return false
  const proof = value as Partial<AgentApprovalProof>
  return typeof proof.requestId === 'string'
    && proof.requestId.length > 0
    && typeof proof.toolCallId === 'string'
    && proof.toolCallId.length > 0
    && typeof proof.approvedAt === 'number'
    && typeof proof.scope === 'string'
    && proof.scope.length > 0
    && (!expectedScope || proof.scope === expectedScope)
    && proof.approvedAt <= now + 5_000
    && now - proof.approvedAt <= 2 * 60_000
}

const CRITICAL_SHELL_PATTERNS: Array<{ pattern: RegExp; code: ExecutionReasonCode }> = [
  { pattern: /(?:^|[;&|]\s*)rm\s+-[^\n]*r[^\n]*f[^\n]*(?:\s+\/\s*$|\s+~\/?\s*$)/i, code: 'shellRmRoot' },
  { pattern: /\b(?:mkfs(?:\.[a-z0-9]+)?|format)\b/i, code: 'shellFormatDisk' },
  { pattern: /\bdd\b[^\n]*\bof=\s*\/dev\//i, code: 'shellBlockDevice' },
  { pattern: /\b(?:reg\s+delete|remove-item)\b[^\n]*(?:system32|sam|security|system\\currentcontrolset)/i, code: 'shellSystemConfig' },
]

const DANGEROUS_SHELL_PATTERNS: Array<{ pattern: RegExp; code: ExecutionReasonCode }> = [
  { pattern: /\b(?:rm|rmdir|del|erase|remove-item)\b/i, code: 'shellDeleteFiles' },
  { pattern: /\b(?:sudo|doas|runas)\b/i, code: 'shellElevate' },
  { pattern: /\b(?:shutdown|reboot|restart-computer|stop-computer)\b/i, code: 'shellSystemState' },
  { pattern: /\b(?:chmod|chown|icacls|takeown)\b/i, code: 'shellPermissions' },
  { pattern: /\b(?:curl|wget|invoke-webrequest|irm|iwr)\b[^\n]*\|\s*(?:bash|sh|zsh|python|node|powershell|pwsh)\b/i, code: 'shellRemoteScript' },
  { pattern: /\b(?:powershell|pwsh)\b[^\n]*(?:-e(?:ncodedcommand)?\b|frombase64string)/i, code: 'shellEncodedPowerShell' },
  { pattern: /(?:`[^`]+`|\$\([^\n)]+\))/i, code: 'shellSubstitution' },
]

const DANGEROUS_GIT_PATTERNS: Array<{ pattern: RegExp; code: ExecutionReasonCode }> = [
  { pattern: /\breset\b[^\n]*\s--hard\b/i, code: 'gitHardReset' },
  { pattern: /\bclean\b[^\n]*\s-[^\s]*f/i, code: 'gitClean' },
  { pattern: /\bpush\b[^\n]*(?:--force(?:-with-lease)?\b|\s-f\b)/i, code: 'gitForcePush' },
  { pattern: /\bbranch\b[^\n]*\s-D\b/, code: 'gitBranchDelete' },
  { pattern: /\bconfig\b[^\n]*\s--(?:global|system)\b/i, code: 'gitGlobalConfig' },
  { pattern: /\bcheckout\b[^\n]*\s--\s+\S+/i, code: 'gitCheckoutOverwrite' },
]

function decision(
  kind: ExecutionDecisionKind,
  risk: ExecutionRisk,
  code: string,
  reason: ExecutionReasonCode,
  params?: Record<string, string | number>,
): ExecutionDecision {
  return { kind, risk, code, reasons: [{ code: reason, ...(params ? { params } : {}) }] }
}

function normalizeExecutable(value: string): string {
  const base = value.trim().split(/[\\/]/).pop()?.toLowerCase() || ''
  return base.replace(/\.(?:cmd|bat|exe)$/i, '')
}

export function splitShellCommandSegments(command: string): string[] | null {
  const parts: string[] = []
  let current = ''
  let quote: "'" | '"' | null = null
  let escaped = false

  for (let index = 0; index < command.length; index++) {
    const character = command[index]
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (character === '\\' && quote !== "'") {
      current += character
      escaped = true
      continue
    }
    if (quote) {
      current += character
      if (character === quote) quote = null
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      current += character
      continue
    }

    const pair = command.slice(index, index + 2)
    if (pair === '&&' || pair === '||' || pair === '|&') {
      if (current.trim()) parts.push(current.trim())
      current = ''
      index++
      continue
    }
    if (character === ';' || character === '|' || character === '&' || character === '\n') {
      if (current.trim()) parts.push(current.trim())
      current = ''
      continue
    }
    current += character
  }

  if (quote || escaped) return null
  if (current.trim()) parts.push(current.trim())
  return parts
}

function firstCommandToken(segment: string): string {
  const tokens = segment.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
  const firstCommand = tokens.find(token => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) || ''
  return normalizeExecutable(firstCommand.replace(/^["']|["']$/g, ''))
}

export function assessShellCommand(command: string, trustedCommands: Iterable<string>): ExecutionDecision {
  const normalized = command.trim()
  if (!normalized) return decision('deny', 'blocked', 'shell.empty', 'shellEmpty')

  for (const rule of CRITICAL_SHELL_PATTERNS) {
    if (rule.pattern.test(normalized)) return decision('ask', 'dangerous', 'shell.critical', rule.code)
  }
  for (const rule of DANGEROUS_SHELL_PATTERNS) {
    if (rule.pattern.test(normalized)) return decision('ask', 'dangerous', 'shell.dangerous', rule.code)
  }

  const segments = splitShellCommandSegments(normalized)
  if (!segments?.length) return decision('deny', 'blocked', 'shell.unparsed', 'shellUnparsed')
  const trusted = new Set(Array.from(trustedCommands, normalizeExecutable))
  const untrusted = segments.map(firstCommandToken).filter(token => !token || !trusted.has(token))
  if (untrusted.length > 0) {
    return decision('ask', 'elevated', 'shell.untrusted', 'shellUntrusted', {
      commands: Array.from(new Set(untrusted)).join(', ') || 'unknown',
    })
  }
  return decision('allow', 'safe', 'shell.trusted', 'shellTrusted')
}

export function findGitSubcommand(args: readonly string[]): string | null {
  let index = 0
  while (index < args.length && args[index].startsWith('-')) {
    index += args[index] === '-c' || args[index] === '-C' ? 2 : 1
  }
  return index < args.length ? normalizeExecutable(args[index]) : null
}

export function assessGitCommand(args: readonly string[], trustedSubcommands: Iterable<string>): ExecutionDecision {
  const subcommand = findGitSubcommand(args)
  if (!subcommand) return decision('deny', 'blocked', 'git.invalid', 'gitInvalid')

  const rendered = args.join(' ')
  for (const rule of DANGEROUS_GIT_PATTERNS) {
    if (rule.pattern.test(rendered)) return decision('ask', 'dangerous', 'git.dangerous', rule.code)
  }

  const trusted = new Set(Array.from(trustedSubcommands, normalizeExecutable))
  if (!trusted.has(subcommand)) {
    return decision('ask', 'elevated', 'git.untrusted', 'gitUntrusted', { subcommand })
  }
  return decision('allow', 'safe', 'git.trusted', 'gitTrusted')
}

/**
 * 目标在工作区之外时升级为审批。
 *
 * 原因是叠加的而不是替换：越界这件事本身要说，但"为什么这条命令危险"同样得留着 ——
 * 用户看到的应该是"命令会删除文件或目录；目标位于工作区外"，而不是只剩后半句。
 */
export function requireExternalPathApproval(base: ExecutionDecision, outsideWorkspace: boolean): ExecutionDecision {
  if (!outsideWorkspace || base.kind === 'deny') return base
  return {
    kind: 'ask',
    risk: base.risk === 'dangerous' ? 'dangerous' : 'elevated',
    code: 'path.external',
    reasons: base.kind === 'ask'
      ? [...base.reasons, { code: 'pathExternal' }]
      : [{ code: 'pathExternal' }],
  }
}

export function isAlwaysApprovalTool(toolName: string): boolean {
  return new Set([
    'write_remote_file',
    'rename_remote_path',
    'delete_remote_path',
    'upload_to_remote',
    'download_from_remote',
  ]).has(toolName)
}
