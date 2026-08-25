import type { SecuritySettings } from './types'
import { pathEquals } from '@shared/utils/pathUtils'

const LEGACY_RUNTIME_SHELL_COMMANDS = [
  'npm', 'yarn', 'pnpm', 'bun',
  'node', 'npx', 'deno',
  'eslint', 'tsc',
  'git',
  'python', 'python3', 'pip', 'pip3',
  'java', 'javac', 'mvn', 'gradle',
  'go', 'rust', 'cargo',
  'make', 'gcc', 'clang', 'cmake',
  'pwd', 'ls', 'dir', 'cat', 'type', 'echo', 'mkdir', 'touch', 'rm', 'mv', 'cp', 'cd',
] as const

const LEGACY_SETTINGS_GIT_SUBCOMMANDS = [
  'status', 'log', 'diff', 'show', 'ls-files', 'rev-parse', 'rev-list', 'blame',
  'add', 'commit', 'reset', 'restore',
  'push', 'pull', 'fetch', 'remote',
  'branch', 'checkout', 'switch', 'merge', 'rebase', 'cherry-pick',
  'clone', 'init', 'stash', 'tag', 'config',
] as const

export const DEFAULT_SECURITY_SHELL_COMMANDS = [
  'npm', 'yarn', 'pnpm', 'bun',
  'node', 'npx', 'deno',
  'powershell', 'pwsh', 'bash', 'sh',
  'eslint', 'tsc',
  'git',
  'python', 'python3', 'py', 'pip', 'pip3',
  'java', 'javac', 'mvn', 'gradle',
  'go', 'rust', 'cargo',
  'make', 'gcc', 'clang', 'cmake',
  'pwd', 'ls', 'dir', 'cat', 'type', 'echo', 'mkdir', 'touch', 'rm', 'mv', 'cp', 'cd',
] as const

export const DEFAULT_SECURITY_GIT_SUBCOMMANDS = [
  'status', 'log', 'diff', 'show', 'ls-files', 'rev-parse', 'rev-list', 'blame',
  'add', 'commit', 'reset', 'restore',
  'push', 'pull', 'fetch', 'remote',
  'branch', 'checkout', 'switch', 'merge', 'rebase', 'cherry-pick',
  'clone', 'init', 'stash', 'tag', 'config', 'symbolic-ref',
  'merge-base', 'notes',
] as const

export const SECURITY_SETTINGS_DEFAULTS = {
  strictWorkspaceMode: true,
  trustedDangerousOperationWorkspaceRoots: [],
  allowedShellCommands: [...DEFAULT_SECURITY_SHELL_COMMANDS],
  allowedGitSubcommands: [...DEFAULT_SECURITY_GIT_SUBCOMMANDS],
} as const satisfies SecuritySettings

function normalizeWorkspaceRootList(roots: unknown): string[] {
  if (!Array.isArray(roots)) return []
  const normalized: string[] = []
  for (const root of roots) {
    if (typeof root !== 'string') continue
    const value = root.trim().replace(/[\\/]+$/, '')
    if (value && !normalized.some(existing => pathEquals(existing, value))) normalized.push(value)
  }
  return normalized
}

export function isDangerousOperationWorkspaceTrusted(
  workspaceRoot: string | null | undefined,
  trustedRoots: readonly string[] | null | undefined,
): boolean {
  return Boolean(
    workspaceRoot
    && trustedRoots?.some(root => pathEquals(root, workspaceRoot)),
  )
}

function normalizeCommandList(
  commands: unknown,
  fallback: readonly string[],
): string[] {
  if (!Array.isArray(commands)) {
    return [...fallback]
  }

  const normalized = Array.from(
    new Set(
      commands
        .filter((command): command is string => typeof command === 'string')
        .map(command => command.trim().toLowerCase())
        .filter(Boolean),
    ),
  )

  return normalized.length > 0 ? normalized : [...fallback]
}

function sameCommandList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function upgradeLegacyList(
  commands: string[],
  legacyDefaults: readonly string[],
  currentDefaults: readonly string[],
): string[] {
  return sameCommandList(commands, legacyDefaults) ? [...currentDefaults] : commands
}

export function normalizeSecuritySettings(settings: unknown): SecuritySettings {
  const candidate = (settings && typeof settings === 'object')
    ? settings as Partial<SecuritySettings>
    : {}

  const allowedShellCommands = upgradeLegacyList(
    normalizeCommandList(candidate.allowedShellCommands, DEFAULT_SECURITY_SHELL_COMMANDS),
    LEGACY_RUNTIME_SHELL_COMMANDS,
    DEFAULT_SECURITY_SHELL_COMMANDS,
  )

  const allowedGitSubcommands = upgradeLegacyList(
    normalizeCommandList(candidate.allowedGitSubcommands, DEFAULT_SECURITY_GIT_SUBCOMMANDS),
    LEGACY_SETTINGS_GIT_SUBCOMMANDS,
    DEFAULT_SECURITY_GIT_SUBCOMMANDS,
  )

  return {
    strictWorkspaceMode: typeof candidate.strictWorkspaceMode === 'boolean'
      ? candidate.strictWorkspaceMode
      : SECURITY_SETTINGS_DEFAULTS.strictWorkspaceMode,
    trustedDangerousOperationWorkspaceRoots: normalizeWorkspaceRootList(
      candidate.trustedDangerousOperationWorkspaceRoots,
    ),
    allowedShellCommands,
    allowedGitSubcommands,
  }
}
