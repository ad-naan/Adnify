export type TerminalShellFamily = 'powershell' | 'cmd' | 'posix'

function normalizeShellToken(shell?: string): string {
  const raw = typeof shell === 'string' ? shell.trim().toLowerCase() : ''
  if (!raw) return ''

  const normalized = raw.replace(/\\/g, '/')
  const shellToken = normalized.split('/').pop() || normalized
  return shellToken.replace(/^"+|"+$/g, '')
}

export function detectTerminalShellFamily(
  shell?: string,
  userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
): TerminalShellFamily {
  const shellToken = normalizeShellToken(shell)

  if (shellToken.includes('powershell') || shellToken === 'pwsh' || shellToken === 'pwsh.exe') {
    return 'powershell'
  }

  if (shellToken === 'cmd' || shellToken === 'cmd.exe') {
    return 'cmd'
  }

  if (
    shellToken === 'bash'
    || shellToken === 'bash.exe'
    || shellToken === 'sh'
    || shellToken === 'sh.exe'
    || shellToken === 'zsh'
    || shellToken === 'zsh.exe'
    || shellToken === 'fish'
    || shellToken === 'fish.exe'
    || shellToken === 'wsl'
    || shellToken === 'wsl.exe'
  ) {
    return 'posix'
  }

  return /windows/i.test(userAgent) ? 'powershell' : 'posix'
}
