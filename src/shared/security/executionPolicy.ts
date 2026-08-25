export type ExecutionDecisionKind = 'allow' | 'ask' | 'deny'
export type ExecutionRisk = 'safe' | 'elevated' | 'dangerous' | 'blocked'

export interface ExecutionDecision {
  kind: ExecutionDecisionKind
  risk: ExecutionRisk
  code: string
  reason: string
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
  reason: {
    zh: string
    en: string
  }
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

const CRITICAL_SHELL_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(?:^|[;&|]\s*)rm\s+-[^\n]*r[^\n]*f[^\n]*(?:\s+\/\s*$|\s+~\/?\s*$)/i, reason: '命令将递归删除系统根目录或用户主目录' },
  { pattern: /\b(?:mkfs(?:\.[a-z0-9]+)?|format)\b/i, reason: '命令将格式化磁盘或文件系统' },
  { pattern: /\bdd\b[^\n]*\bof=\s*\/dev\//i, reason: '命令将直接覆写块设备' },
  { pattern: /\b(?:reg\s+delete|remove-item)\b[^\n]*(?:system32|sam|security|system\\currentcontrolset)/i, reason: '命令将修改系统关键配置' },
]

const DANGEROUS_SHELL_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(?:rm|rmdir|del|erase|remove-item)\b/i, reason: '命令会删除文件或目录' },
  { pattern: /\b(?:sudo|doas|runas)\b/i, reason: '命令请求提升系统权限' },
  { pattern: /\b(?:shutdown|reboot|restart-computer|stop-computer)\b/i, reason: '命令会改变系统运行状态' },
  { pattern: /\b(?:chmod|chown|icacls|takeown)\b/i, reason: '命令会修改文件权限或所有权' },
  { pattern: /\b(?:curl|wget|invoke-webrequest|irm|iwr)\b[^\n]*\|\s*(?:bash|sh|zsh|python|node|powershell|pwsh)\b/i, reason: '命令会执行网络下载的内容' },
  { pattern: /\b(?:powershell|pwsh)\b[^\n]*(?:-e(?:ncodedcommand)?\b|frombase64string)/i, reason: '命令包含编码后的 PowerShell 指令' },
  { pattern: /(?:`[^`]+`|\$\([^\n)]+\))/i, reason: '命令包含动态命令替换' },
]

const DANGEROUS_GIT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\breset\b[^\n]*\s--hard\b/i, reason: 'Git hard reset 会丢弃未提交修改' },
  { pattern: /\bclean\b[^\n]*\s-[^\s]*f/i, reason: 'Git clean 会删除未跟踪文件' },
  { pattern: /\bpush\b[^\n]*(?:--force(?:-with-lease)?\b|\s-f\b)/i, reason: '强制推送会重写远程历史' },
  { pattern: /\bbranch\b[^\n]*\s-D\b/, reason: '强制删除分支可能丢失提交' },
  { pattern: /\bconfig\b[^\n]*\s--(?:global|system)\b/i, reason: '操作会修改工作区之外的 Git 配置' },
  { pattern: /\bcheckout\b[^\n]*\s--\s+\S+/i, reason: '操作会覆盖工作区文件内容' },
]

function decision(kind: ExecutionDecisionKind, risk: ExecutionRisk, code: string, reason: string): ExecutionDecision {
  return { kind, risk, code, reason }
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
  if (!normalized) return decision('deny', 'blocked', 'shell.empty', '命令为空')

  for (const rule of CRITICAL_SHELL_PATTERNS) {
    if (rule.pattern.test(normalized)) return decision('ask', 'dangerous', 'shell.critical', rule.reason)
  }
  for (const rule of DANGEROUS_SHELL_PATTERNS) {
    if (rule.pattern.test(normalized)) return decision('ask', 'dangerous', 'shell.dangerous', rule.reason)
  }

  const segments = splitShellCommandSegments(normalized)
  if (!segments?.length) return decision('deny', 'blocked', 'shell.unparsed', '命令结构无效，无法安全解析')
  const trusted = new Set(Array.from(trustedCommands, normalizeExecutable))
  const untrusted = segments.map(firstCommandToken).filter(token => !token || !trusted.has(token))
  if (untrusted.length > 0) {
    return decision('ask', 'elevated', 'shell.untrusted', `命令不在可信自动执行列表：${Array.from(new Set(untrusted)).join(', ') || 'unknown'}`)
  }
  return decision('allow', 'safe', 'shell.trusted', '命令位于可信自动执行列表')
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
  if (!subcommand) return decision('deny', 'blocked', 'git.invalid', '未找到 Git 子命令')

  const rendered = args.join(' ')
  for (const rule of DANGEROUS_GIT_PATTERNS) {
    if (rule.pattern.test(rendered)) return decision('ask', 'dangerous', 'git.dangerous', rule.reason)
  }

  const trusted = new Set(Array.from(trustedSubcommands, normalizeExecutable))
  if (!trusted.has(subcommand)) {
    return decision('ask', 'elevated', 'git.untrusted', `Git 子命令不在可信自动执行列表：${subcommand}`)
  }
  return decision('allow', 'safe', 'git.trusted', 'Git 子命令位于可信自动执行列表')
}

export function requireExternalPathApproval(base: ExecutionDecision, outsideWorkspace: boolean): ExecutionDecision {
  if (!outsideWorkspace || base.kind === 'deny') return base
  return decision(
    'ask',
    base.risk === 'dangerous' ? 'dangerous' : 'elevated',
    'path.external',
    base.kind === 'ask' ? `${base.reason}；目标位于工作区外` : '目标位于工作区外',
  )
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
