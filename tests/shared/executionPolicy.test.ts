import { describe, expect, it } from 'vitest'
import {
  assessGitCommand,
  assessShellCommand,
  commandApprovalScope,
  isRecentAgentApprovalProof,
  requireExternalPathApproval,
} from '@shared/security/executionPolicy'

describe('execution security policy', () => {
  const shell = ['git', 'npm', 'node', 'echo']
  const git = ['status', 'log', 'reset', 'push']

  it('allows trusted low-risk commands', () => {
    expect(assessShellCommand('npm test', shell).kind).toBe('allow')
    expect(assessGitCommand(['status', '--short'], git).kind).toBe('allow')
  })

  it('asks instead of rejecting an untrusted command', () => {
    expect(assessShellCommand('custom-tool build', shell)).toMatchObject({ kind: 'ask', code: 'shell.untrusted' })
    expect(assessGitCommand(['worktree', 'list'], git)).toMatchObject({ kind: 'ask', code: 'git.untrusted' })
  })

  it('rejects structurally invalid shell input', () => {
    expect(assessShellCommand('echo "unterminated', shell)).toMatchObject({
      kind: 'deny',
      risk: 'blocked',
      code: 'shell.unparsed',
    })
  })

  it('never auto-runs dangerous commands even when their executable is trusted', () => {
    expect(assessShellCommand('rm -rf build', [...shell, 'rm'])).toMatchObject({ kind: 'ask', risk: 'dangerous' })
    expect(assessGitCommand(['reset', '--hard', 'HEAD~1'], git)).toMatchObject({ kind: 'ask', risk: 'dangerous' })
  })

  it('requires explicit approval instead of silently rejecting catastrophic commands', () => {
    expect(assessShellCommand('rm -rf /', [...shell, 'rm'])).toMatchObject({ kind: 'ask', risk: 'dangerous', code: 'shell.critical' })
  })

  it('upgrades an otherwise safe command when cwd is outside the workspace', () => {
    const safe = assessShellCommand('npm test', shell)
    expect(requireExternalPathApproval(safe, true)).toMatchObject({ kind: 'ask', code: 'path.external' })
  })

  it('accepts only recent approval proofs for the exact scope', () => {
    const now = Date.now()
    const scope = commandApprovalScope('custom-tool build', 'C:\\workspace')
    const proof = { requestId: 'request-1', toolCallId: 'tool-1', approvedAt: now, scope }

    expect(isRecentAgentApprovalProof(proof, scope, now)).toBe(true)
    expect(isRecentAgentApprovalProof(proof, `${scope} --other`, now)).toBe(false)
    expect(isRecentAgentApprovalProof({ ...proof, approvedAt: now - 121_000 }, scope, now)).toBe(false)
  })
})
