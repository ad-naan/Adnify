import type { TerminalCommandRule } from '@shared/config/types'
import { assessGitCommand, assessShellCommand, splitShellCommandSegments } from './executionPolicy'

const SAFE_TOKEN = /^[\p{L}\p{N}._:@/+\-=]+$/u

const DYNAMIC_LAUNCHER_ARGUMENTS: Record<string, RegExp> = {
  powershell: /^-(?:c|command)$/i,
  pwsh: /^-(?:c|command)$/i,
  cmd: /^\/(?:c|k)$/i,
  bash: /^-c$/i,
  sh: /^-c$/i,
  zsh: /^-c$/i,
  fish: /^-c$/i,
  python: /^-c$/i,
  python3: /^-c$/i,
  py: /^-c$/i,
  node: /^(?:-e|--eval)$/i,
  deno: /^eval$/i,
  bun: /^(?:-e|--eval)$/i,
}

function tokenize(command: string): string[] {
  return (command.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [])
    .map(token => {
      const quoted = (token.startsWith('"') && token.endsWith('"'))
        || (token.startsWith("'") && token.endsWith("'"))
      return quoted ? token.slice(1, -1) : token
    })
}

function normalizeExecutable(value: string): string {
  return value.trim().toLowerCase().replace(/\.exe$/i, '')
}

function isSafeRuleToken(token: string): boolean {
  if (!token || token.length > 80 || !SAFE_TOKEN.test(token)) return false
  if (/^(?:\.{0,2}[\\/]|[A-Za-z]:[\\/])/.test(token)) return false
  if (token.includes('\\')) return false
  return !token.includes('/') || /^@[\p{L}\p{N}._-]+\/[\p{L}\p{N}._-]+$/u.test(token)
}

function isDynamicLauncherPrefix(executable: string, argumentPrefix: readonly string[]): boolean {
  const pattern = DYNAMIC_LAUNCHER_ARGUMENTS[normalizeExecutable(executable)]
  return Boolean(pattern && argumentPrefix[0] && pattern.test(argumentPrefix[0]))
}

export function terminalCommandRuleKey(rule: TerminalCommandRule): string {
  return `${normalizeExecutable(rule.executable)}\u0000${rule.argumentPrefix.join('\u0000')}`
}

export function formatTerminalCommandRule(rule: TerminalCommandRule): string {
  return [rule.executable, ...rule.argumentPrefix].join(' ')
}

export function validateTerminalCommandRuleProposal(
  command: unknown,
  proposal: unknown,
): TerminalCommandRule | null {
  if (typeof command !== 'string' || !proposal || typeof proposal !== 'object') return null
  if (!isCommandEligibleForPersistentApproval(command)) return null
  const segments = splitShellCommandSegments(command)
  if (!segments || segments.length !== 1 || /`|\$\(/.test(command)) return null

  const candidate = proposal as Record<string, unknown>
  if (typeof candidate.executable !== 'string' || !Array.isArray(candidate.argument_prefix)) return null
  const executable = normalizeExecutable(candidate.executable)
  const argumentPrefix = candidate.argument_prefix
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
  if (!executable || argumentPrefix.length === 0 || argumentPrefix.length !== candidate.argument_prefix.length) return null
  if (!isSafeRuleToken(executable) || !argumentPrefix.every(isSafeRuleToken)) return null
  if (isDynamicLauncherPrefix(executable, argumentPrefix)) return null

  const actual = tokenize(segments[0])
  if (normalizeExecutable(actual[0] || '') !== executable) return null
  if (argumentPrefix.length > actual.length - 1) return null
  if (!argumentPrefix.every((token, index) => token === actual[index + 1])) return null

  const description = typeof candidate.description === 'string'
    ? candidate.description.trim().slice(0, 120)
    : undefined
  return { executable, argumentPrefix, ...(description ? { description } : {}) }
}

export function deriveTerminalCommandRule(command: unknown): TerminalCommandRule | null {
  if (typeof command !== 'string' || !isCommandEligibleForPersistentApproval(command)) return null
  const segments = splitShellCommandSegments(command)
  if (!segments || segments.length !== 1 || /`|\$\(/.test(command)) return null

  const actual = tokenize(segments[0])
  const executable = normalizeExecutable(actual[0] || '')
  const args = actual.slice(1)
  if (!isSafeRuleToken(executable) || args.length === 0) return null

  const argumentPrefix = ['npm', 'pnpm', 'yarn', 'bun'].includes(executable)
    && args[0] === 'run'
    && args[1]
    ? args.slice(0, 2)
    : args.slice(0, 1)
  if (!argumentPrefix.every(isSafeRuleToken)) return null
  if (isDynamicLauncherPrefix(executable, argumentPrefix)) return null

  return { executable, argumentPrefix }
}

export function isCommandEligibleForPersistentApproval(command: string): boolean {
  const policy = assessShellCommand(command, [])
  if (policy.kind === 'deny' || policy.risk === 'dangerous' || policy.risk === 'blocked') return false
  const segments = splitShellCommandSegments(command)
  if (!segments?.length || /`|\$\(/.test(command)) return false
  return segments.every(segment => {
    const tokens = tokenize(segment)
    if (normalizeExecutable(tokens[0] || '') !== 'git') return true
    const gitPolicy = assessGitCommand(tokens.slice(1), [])
    return gitPolicy.kind !== 'deny' && gitPolicy.risk !== 'dangerous' && gitPolicy.risk !== 'blocked'
  })
}

export function matchesTerminalCommandRule(command: string, rule: TerminalCommandRule): boolean {
  const tokens = tokenize(command)
  if (normalizeExecutable(tokens[0] || '') !== normalizeExecutable(rule.executable)) return false
  return rule.argumentPrefix.every((token, index) => token === tokens[index + 1])
}

export function legacyTerminalCommandRule(value: string): TerminalCommandRule | null {
  const normalized = value.trim().replace(/\s+\*$/, '')
  if (!normalized || normalized.includes('*')) return null
  const tokens = tokenize(normalized)
  if (tokens.length < 2) return null
  const executable = normalizeExecutable(tokens[0])
  const argumentPrefix = tokens.slice(1)
  if (!isSafeRuleToken(executable) || !argumentPrefix.every(isSafeRuleToken)) return null
  if (isDynamicLauncherPrefix(executable, argumentPrefix)) return null
  return { executable, argumentPrefix, description: 'Migrated from a legacy command rule' }
}
