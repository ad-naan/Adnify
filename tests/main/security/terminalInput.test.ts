import { describe, expect, it } from 'vitest'

import { normalizePipeTerminalInput } from '@main/security/terminalInput'

describe('normalizePipeTerminalInput', () => {
  it('converts carriage returns into newlines for pipe-backed shells', () => {
    expect(normalizePipeTerminalInput('npm run dev\r')).toBe('npm run dev\n')
    expect(normalizePipeTerminalInput('printf "ok"\rexit\r')).toBe('printf "ok"\nexit\n')
  })

  it('normalizes CRLF without duplicating line breaks', () => {
    expect(normalizePipeTerminalInput('echo hi\r\necho there\r\n')).toBe('echo hi\necho there\n')
  })

  it('preserves control characters like Ctrl+C', () => {
    expect(normalizePipeTerminalInput(String.fromCharCode(3))).toBe(String.fromCharCode(3))
  })
})
