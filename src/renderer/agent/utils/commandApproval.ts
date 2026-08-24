import type { TerminalCommandRule } from '@shared/config/types'
import { assessShellCommand, splitShellCommandSegments } from '@shared/security/executionPolicy'
import { isCommandEligibleForPersistentApproval, matchesTerminalCommandRule } from '@shared/security/commandApprovalRule'

export { matchesTerminalCommandRule, validateTerminalCommandRuleProposal } from '@shared/security/commandApprovalRule'

export function isTerminalCommandAutoApproved(
  command: unknown,
  allowedRules: readonly TerminalCommandRule[] | undefined,
): boolean {
  if (typeof command !== 'string' || !allowedRules?.length) return false
  if (!isCommandEligibleForPersistentApproval(command)) return false
  const parts = splitShellCommandSegments(command)
  if (!parts?.length) return false

  // Dynamic evaluation can smuggle additional commands past text patterns.
  if (parts.some(part => /`|\$\(/.test(part))) return false
  return parts.every(part => allowedRules.some(rule => matchesTerminalCommandRule(part, rule)))
}

export function isTerminalCommandEligibleForAutoApproval(
  command: unknown,
  allowedRules: readonly TerminalCommandRule[] | undefined,
  trustedCommands: readonly string[],
): boolean {
  if (typeof command !== 'string') return false
  return assessShellCommand(command, trustedCommands).kind === 'allow'
    && isTerminalCommandAutoApproved(command, allowedRules)
}
