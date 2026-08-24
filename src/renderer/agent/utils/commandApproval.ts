import { assessShellCommand, splitShellCommandSegments } from '@shared/security/executionPolicy'

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function matchesTerminalCommandRule(command: string, rule: string): boolean {
  const normalizedCommand = command.trim()
  const normalizedRule = rule.trim()
  if (!normalizedCommand || !normalizedRule) return false
  if (!normalizedRule.includes('*')) return normalizedCommand === normalizedRule

  const trailingWordWildcard = normalizedRule.endsWith(' *')
  const body = trailingWordWildcard ? normalizedRule.slice(0, -2) : normalizedRule
  const regexBody = body.split('*').map(escapeRegex).join('.*')
  const suffix = trailingWordWildcard ? '(?:\\s+.*)?' : ''
  return new RegExp(`^${regexBody}${suffix}$`).test(normalizedCommand)
}

export function isTerminalCommandAutoApproved(
  command: unknown,
  allowedRules: readonly string[] | undefined,
): boolean {
  if (typeof command !== 'string' || !allowedRules?.length) return false
  const policy = assessShellCommand(command, [])
  if (policy.risk === 'dangerous' || policy.risk === 'blocked') return false
  const parts = splitShellCommandSegments(command)
  if (!parts?.length) return false

  // Dynamic evaluation can smuggle additional commands past text patterns.
  if (parts.some(part => /`|\$\(/.test(part))) return false
  return parts.every(part => allowedRules.some(rule => matchesTerminalCommandRule(part, rule)))
}

export function isTerminalCommandEligibleForAutoApproval(
  command: unknown,
  allowedRules: readonly string[] | undefined,
  trustedCommands: readonly string[],
): boolean {
  if (typeof command !== 'string') return false
  return assessShellCommand(command, trustedCommands).kind === 'allow'
    && isTerminalCommandAutoApproved(command, allowedRules)
}

function tokenizeCommandPrefix(command: string): string[] {
  return command.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
}

export function suggestTerminalCommandRule(command: string): string {
  const parts = splitShellCommandSegments(command)
  if (!parts || parts.length !== 1) return command.trim()
  const tokens = tokenizeCommandPrefix(parts[0])
  if (tokens.length === 0) return ''
  if (tokens.length === 1) return `${tokens[0]} *`

  const executable = tokens[0].toLowerCase()
  const prefixLength = ['npm', 'pnpm', 'yarn', 'bun'].includes(executable) && tokens[1] === 'run'
    ? Math.min(3, tokens.length)
    : 2
  return `${tokens.slice(0, prefixLength).join(' ')} *`
}
