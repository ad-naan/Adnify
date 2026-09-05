import { describe, expect, it } from 'vitest'

import {
  getInteractiveTerminalBackend,
  isLongRunningCommand,
} from '@renderer/agent/tools/commandRuntime'

describe('commandRuntime', () => {
  it('routes macOS interactive agent sessions away from PTY', () => {
    expect(getInteractiveTerminalBackend('darwin')).toBe('pipe')
  })

  it('keeps PTY backend on non-macOS platforms', () => {
    expect(getInteractiveTerminalBackend('linux')).toBe('pty')
    expect(getInteractiveTerminalBackend('win32')).toBe('pty')
  })

  it('detects long-running commands and explicit background requests', () => {
    expect(isLongRunningCommand('npm run dev')).toBe(true)
    expect(isLongRunningCommand('vite')).toBe(true)
    expect(isLongRunningCommand('npm run dev', false)).toBe(false)
    expect(isLongRunningCommand('vite build')).toBe(false)
    expect(isLongRunningCommand('echo vite')).toBe(false)
    expect(isLongRunningCommand('npm test', true)).toBe(true)
    expect(isLongRunningCommand('npm test', false)).toBe(false)
  })
})
