import { describe, expect, it } from 'vitest'
import {
  normalizeSecuritySettings,
  SECURITY_SETTINGS_DEFAULTS,
} from '@shared/config/securitySettings'

describe('security settings normalization', () => {
  it('upgrades the legacy git default whitelist to the current default set', () => {
    const normalized = normalizeSecuritySettings({
      strictWorkspaceMode: true,
      allowedShellCommands: [...SECURITY_SETTINGS_DEFAULTS.allowedShellCommands],
      allowedGitSubcommands: [
        'status', 'log', 'diff', 'show', 'ls-files', 'rev-parse', 'rev-list', 'blame',
        'add', 'commit', 'reset', 'restore',
        'push', 'pull', 'fetch', 'remote',
        'branch', 'checkout', 'switch', 'merge', 'rebase', 'cherry-pick',
        'clone', 'init', 'stash', 'tag', 'config',
      ],
    })

    expect(normalized.allowedGitSubcommands).toEqual(
      SECURITY_SETTINGS_DEFAULTS.allowedGitSubcommands,
    )
  })

  it('upgrades the legacy runtime shell whitelist to the current default set', () => {
    const normalized = normalizeSecuritySettings({
      allowedShellCommands: [
        'npm', 'yarn', 'pnpm', 'bun',
        'node', 'npx', 'deno',
        'eslint', 'tsc',
        'git',
        'python', 'python3', 'pip', 'pip3',
        'java', 'javac', 'mvn', 'gradle',
        'go', 'rust', 'cargo',
        'make', 'gcc', 'clang', 'cmake',
        'pwd', 'ls', 'dir', 'cat', 'type', 'echo', 'mkdir', 'touch', 'rm', 'mv', 'cp', 'cd',
      ],
    })

    expect(normalized.allowedShellCommands).toEqual(
      SECURITY_SETTINGS_DEFAULTS.allowedShellCommands,
    )
  })

  it('preserves intentional custom git whitelists', () => {
    const normalized = normalizeSecuritySettings({
      allowedGitSubcommands: ['status', 'log'],
    })

    expect(normalized.allowedGitSubcommands).toEqual(['status', 'log'])
  })

  it('normalizes casing and removes duplicate commands', () => {
    const normalized = normalizeSecuritySettings({
      allowedGitSubcommands: ['Status', 'status', ' LOG '],
      allowedShellCommands: [' Bash ', 'bash', 'NODE'],
    })

    expect(normalized.allowedGitSubcommands).toEqual(['status', 'log'])
    expect(normalized.allowedShellCommands).toEqual(['bash', 'node'])
  })

  it('drops removed legacy confirmation flags', () => {
    const normalized = normalizeSecuritySettings({
      enablePermissionConfirm: false,
      showSecurityWarnings: false,
    })

    expect(normalized).not.toHaveProperty('enablePermissionConfirm')
    expect(normalized).not.toHaveProperty('showSecurityWarnings')
  })
})
