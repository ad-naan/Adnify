import { describe, expect, it } from 'vitest'
import {
  isTerminalCommandAutoApproved,
  isTerminalCommandEligibleForAutoApproval,
  matchesTerminalCommandRule,
  validateTerminalCommandRuleProposal,
} from '@renderer/agent/utils/commandApproval'

const rule = (executable: string, ...argumentPrefix: string[]) => ({ executable, argumentPrefix })

describe('terminal command approval', () => {
  it('matches a literal executable and argument prefix', () => {
    expect(matchesTerminalCommandRule('git status', rule('git', 'status'))).toBe(true)
    expect(matchesTerminalCommandRule('git status --short', rule('git', 'status'))).toBe(true)
    expect(matchesTerminalCommandRule('git statusx', rule('git', 'status'))).toBe(false)
  })

  it('requires both a trusted executable and a matching terminal rule', () => {
    expect(isTerminalCommandEligibleForAutoApproval('node --version', [rule('node', '--version')], ['node'])).toBe(true)
    expect(isTerminalCommandEligibleForAutoApproval('custom-tool --version', [rule('custom-tool', '--version')], ['node'])).toBe(false)
    expect(isTerminalCommandEligibleForAutoApproval('rm -rf build', [rule('rm', '-rf')], ['rm'])).toBe(false)
  })

  it('requires every compound subcommand to be allowed', () => {
    expect(isTerminalCommandAutoApproved('git status && npm test', [rule('git', 'status'), rule('npm', 'test')])).toBe(true)
    expect(isTerminalCommandAutoApproved('git status && rm -rf build', [rule('git', 'status')])).toBe(false)
    expect(isTerminalCommandAutoApproved('git status; npm test', [rule('git', 'status')])).toBe(false)
  })

  it('does not auto-approve dynamic command substitution', () => {
    expect(isTerminalCommandAutoApproved('echo $(dangerous)', [rule('echo', 'safe')])).toBe(false)
    expect(isTerminalCommandAutoApproved('echo `dangerous`', [rule('echo', 'safe')])).toBe(false)
  })

  it('never auto-approves destructive commands even when a rule matches', () => {
    expect(isTerminalCommandAutoApproved('rm -rf build', [rule('rm', '-rf')])).toBe(false)
    expect(isTerminalCommandAutoApproved('powershell -EncodedCommand ZQBjAGgAbwA=', [rule('powershell', '-EncodedCommand')])).toBe(false)
    expect(isTerminalCommandAutoApproved('git reset --hard HEAD', [rule('git', 'reset')])).toBe(false)
  })

  it('accepts only AI proposals that are literal prefixes of the actual safe command', () => {
    expect(validateTerminalCommandRuleProposal('pnpm run test --watch', {
      executable: 'pnpm', argument_prefix: ['run', 'test'], description: 'Run tests',
    })).toEqual({ executable: 'pnpm', argumentPrefix: ['run', 'test'], description: 'Run tests' })
    expect(validateTerminalCommandRuleProposal('git status --short', {
      executable: 'git', argument_prefix: ['diff'], description: 'Too broad and mismatched',
    })).toBeNull()
    expect(validateTerminalCommandRuleProposal('git status && npm test', {
      executable: 'git', argument_prefix: ['status'], description: 'Compound',
    })).toBeNull()
    expect(validateTerminalCommandRuleProposal('git reset --hard HEAD', {
      executable: 'git', argument_prefix: ['reset'], description: 'Dangerous',
    })).toBeNull()
  })
})
