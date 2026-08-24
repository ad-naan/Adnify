import type { TerminalCommandRule } from '@shared/config/types'
import { assessGitCommand, assessShellCommand, splitShellCommandSegments } from './executionPolicy'

const SAFE_TOKEN = /^[\p{L}\p{N}._:@/+\-=]+$/u

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
  if (![executable, ...argumentPrefix].every(token => token.length > 0 && token.length <= 80 && SAFE_TOKEN.test(token))) return null

  const actual = tokenize(segments[0])
  if (normalizeExecutable(actual[0] || '') !== executable) return null
  if (argumentPrefix.length > actual.length - 1) return null
  if (!argumentPrefix.every((token, index) => token === actual[index + 1])) return null

  const description = typeof candidate.description === 'string'
    ? candidate.description.trim().slice(0, 120)
    : undefined
  return { executable, argumentPrefix, ...(description ? { description } : {}) }
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
  if (![executable, ...argumentPrefix].every(token => SAFE_TOKEN.test(token))) return null
  return { executable, argumentPrefix, description: 'Migrated from a legacy command rule' }
}
