import { describe, expect, it } from 'vitest'

import { detectTerminalShellFamily } from '@renderer/services/terminalShell'

describe('detectTerminalShellFamily', () => {
  it('treats Git Bash on Windows as a POSIX shell', () => {
    expect(detectTerminalShellFamily('C:\\Program Files\\Git\\bin\\bash.exe', 'Windows NT 10.0')).toBe('posix')
  })

  it('keeps PowerShell shells on the PowerShell code path', () => {
    expect(detectTerminalShellFamily('powershell.exe', 'Windows NT 10.0')).toBe('powershell')
    expect(detectTerminalShellFamily('pwsh.exe', 'Windows NT 10.0')).toBe('powershell')
  })

  it('falls back to the host platform only when the shell is unknown', () => {
    expect(detectTerminalShellFamily('', 'Windows NT 10.0')).toBe('powershell')
    expect(detectTerminalShellFamily('', 'Macintosh')).toBe('posix')
  })
})
