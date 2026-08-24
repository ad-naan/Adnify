import { describe, expect, it } from 'vitest'
import {
  isTerminalCommandAutoApproved,
  isTerminalCommandEligibleForAutoApproval,
  matchesTerminalCommandRule,
  suggestTerminalCommandRule,
} from '@renderer/agent/utils/commandApproval'

describe('terminal command approval', () => {
  it('supports Claude-style word-boundary wildcards', () => {
    expect(matchesTerminalCommandRule('git status', 'git status *')).toBe(true)
    expect(matchesTerminalCommandRule('git status --short', 'git status *')).toBe(true)
    expect(matchesTerminalCommandRule('git statusx', 'git status *')).toBe(false)
  })

  it('requires both a trusted executable and a matching terminal rule', () => {
    expect(isTerminalCommandEligibleForAutoApproval('node --version', ['node --version'], ['node'])).toBe(true)
    expect(isTerminalCommandEligibleForAutoApproval('custom-tool --version', ['custom-tool *'], ['node'])).toBe(false)
    expect(isTerminalCommandEligibleForAutoApproval('rm -rf build', ['rm *'], ['rm'])).toBe(false)
  })

  it('requires every compound subcommand to be allowed', () => {
    expect(isTerminalCommandAutoApproved('git status && npm test', ['git status *', 'npm test *'])).toBe(true)
    expect(isTerminalCommandAutoApproved('git status && rm -rf build', ['git status *'])).toBe(false)
    expect(isTerminalCommandAutoApproved('git status; npm test', ['git status *'])).toBe(false)
  })

  it('does not auto-approve dynamic command substitution', () => {
    expect(isTerminalCommandAutoApproved('echo $(dangerous)', ['echo *'])).toBe(false)
    expect(isTerminalCommandAutoApproved('echo `dangerous`', ['echo *'])).toBe(false)
  })

  it('never auto-approves destructive commands even when a rule matches', () => {
    expect(isTerminalCommandAutoApproved('rm -rf build', ['rm *'])).toBe(false)
    expect(isTerminalCommandAutoApproved('powershell -EncodedCommand ZQBjAGgAbwA=', ['powershell *'])).toBe(false)
  })

  it('suggests useful, bounded prefixes', () => {
    expect(suggestTerminalCommandRule('git status --short')).toBe('git status *')
    expect(suggestTerminalCommandRule('pnpm run test --watch')).toBe('pnpm run test *')
    expect(suggestTerminalCommandRule('git status && npm test')).toBe('git status && npm test')
  })
})
