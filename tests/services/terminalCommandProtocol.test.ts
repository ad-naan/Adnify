import { describe, expect, it } from 'vitest'
import {
  createTerminalCommandFrameState,
  pushTerminalCommandFrame,
} from '@renderer/services/terminalCommandProtocol'

describe('terminal command framing protocol', () => {
  it('captures output when both sentinels and output share one PTY chunk', () => {
    const state = createTerminalCommandFrameState('samechunk')
    const result = pushTerminalCommandFrame(
      state,
      `echoed wrapper\r\n\x1b]9001;ADNIFY_CMD_START_samechunk\x07actual output\r\n\x1b]9001;ADNIFY_CMD_END_samechunk_7\x07prompt> `,
    )
    expect(result).toMatchObject({
      output: 'actual output\r\n',
      trailing: 'prompt> ',
      started: true,
      ended: true,
      exitCode: 7,
    })
  })

  it('survives every marker split without leaking wrapper or protocol text', () => {
    const state = createTerminalCommandFrameState('split')
    const trace = `internal wrapper\r\n\x1b]9001;ADNIFY_CMD_START_split\x07one\r\ntwo\r\n\x1b]9001;ADNIFY_CMD_END_split_0\x07prompt`
    let output = ''
    let trailing = ''
    for (const character of trace) {
      const result = pushTerminalCommandFrame(state, character)
      output += result.output
      trailing += result.trailing
    }
    expect(output).toBe('one\r\ntwo\r\n')
    expect(trailing).toBe('prompt')
    expect(`${output}${trailing}`).not.toMatch(/internal wrapper|ADNIFY_CMD_/)
  })
})
