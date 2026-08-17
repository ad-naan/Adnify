import { describe, expect, it } from 'vitest'
import {
  createShellIntegrationOscParser,
  parseShellIntegrationPayload,
  SHELL_INTEGRATION_OSC_ID,
} from '@renderer/services/terminalShellIntegration'

describe('terminalShellIntegration', () => {
  it('uses the VS Code-compatible OSC id', () => {
    expect(SHELL_INTEGRATION_OSC_ID).toBe(633)
  })

  it('parses prompt, command line, and command start', () => {
    expect(parseShellIntegrationPayload('A')).toEqual({
      phase: 'prompt',
      metadata: '',
    })
    expect(parseShellIntegrationPayload('P;Adnify;1')).toEqual({
      phase: 'prompt',
      metadata: 'Adnify;1',
    })
    expect(parseShellIntegrationPayload('E;npm test -- --watch=false')).toEqual({
      phase: 'command-line',
      commandLine: 'npm test -- --watch=false',
    })
    expect(parseShellIntegrationPayload('C')).toEqual({ phase: 'command-start' })
  })

  it('parses command end and ignores trailing properties', () => {
    expect(parseShellIntegrationPayload('D;7;nonce=abc')).toEqual({
      phase: 'command-end',
      exitCode: 7,
    })
    expect(parseShellIntegrationPayload('D;0')).toEqual({
      phase: 'command-end',
      exitCode: 0,
    })
  })

  it('rejects malformed lifecycle payloads', () => {
    expect(parseShellIntegrationPayload('D;failed')).toBeNull()
    expect(parseShellIntegrationPayload('X;unknown')).toBeNull()
  })

  it('parses OSC 633 from chunks when xterm lacks registerOscHandler', () => {
    const parser = createShellIntegrationOscParser()

    expect(parser.push('before\x1b]633;P;Ad')).toEqual([])
    expect(parser.push('nify;1\x07after\x1b]633;')).toEqual(['P;Adnify;1'])
    expect(parser.push('D;7\x1b\\')).toEqual(['D;7'])
    expect(parser.push('\x1b]633;C')).toEqual([])
    // A later OSC start marks the earlier unterminated sequence malformed.
    expect(parser.push('\x1b]633;E;npm test\x07')).toEqual(['C\x1b]633;E;npm test'])
  })

  it('parses short output and command end delivered in one chunk', () => {
    const parser = createShellIntegrationOscParser()

    expect(parser.push('\x1b]633;A\x07')).toEqual(['A'])
    expect(parser.push('Hello\r\n\x1b]633;D;0\x07')).toEqual(['D;0'])
  })

  it('does not drop a ready sequence split at every PTY chunk boundary', () => {
    const parser = createShellIntegrationOscParser()
    const chunks = Array.from('\x1b]633;P;Adnify;1\x07')

    const payloads = chunks.flatMap(chunk => parser.push(chunk))
    expect(payloads).toEqual(['P;Adnify;1'])
  })

  it('keeps an unterminated sequence across arbitrary non-OSC chunks', () => {
    const parser = createShellIntegrationOscParser()

    expect(parser.push('startup\r\n\x1b]633;')).toEqual([])
    expect(parser.push('P;Adnify;1')).toEqual([])
    expect(parser.push('\x07ready\r\n')).toEqual(['P;Adnify;1'])
  })

  it('drops a malformed unterminated sequence instead of retaining it forever', () => {
    const parser = createShellIntegrationOscParser()
    const prefix = '\x1b]633;'
    const malformedLength = 16_384 - prefix.length

    expect(parser.push(prefix + 'C'.repeat(malformedLength + 32))).toEqual([])
    // The malformed sequence has been discarded and cannot swallow a later event.
    expect(parser.push('\x1b]633;D;7\x07')).toEqual(['D;7'])
  })
})
