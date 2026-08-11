/**
 * terminalTextExtraction.test.ts
 *
 * 测试终端原始字节流 → 模型可读文本 的三个阶段：
 *   stripAnsi（无状态剥离） / createAnsiStripper（有状态跨块剥离） / renderTerminalText（CR/BS 覆写）
 *
 * 这些函数正是 Agent shell 工具「一坨乱码字符串」问题的核心修复——
 * 验证它们覆盖了所有终端常见的转义序列族，并正确还原 CR/BS 语义。
 */
import { describe, it, expect } from 'vitest'
import {
  scanEscapeSequence,
  stripAnsi,
  createAnsiStripper,
  renderTerminalText,
} from './terminalTextExtraction'

// ─── scanEscapeSequence ───────────────────────────────────────────────────────

describe('scanEscapeSequence', () => {
  it('parses simple CSI: ESC[32m', () => {
    const s = '\x1b[32m'
    expect(scanEscapeSequence(s, 0)).toBe(5)
  })

  it('parses CSI with ? intermediate (DECSET): ESC[?25h', () => {
    const s = '\x1b[?25h'
    expect(scanEscapeSequence(s, 0)).toBe(6)
  })

  it('parses CSI with SGR: ESC[1;32;40m', () => {
    const s = '\x1b[1;32;40m'
    expect(scanEscapeSequence(s, 0)).toBe(s.length)
  })

  it('returns -1 for CSI with no final byte yet', () => {
    expect(scanEscapeSequence('\x1b[32', 0)).toBe(-1)
  })

  it('returns -1 for bare ESC at end of string', () => {
    expect(scanEscapeSequence('\x1b', 0)).toBe(-1)
  })

  it('parses OSC with BEL terminator: ESC]0;title BEL', () => {
    const s = '\x1b]0;title\x07'
    expect(scanEscapeSequence(s, 0)).toBe(s.length)
  })

  it('parses OSC with ST terminator (ESC \\)', () => {
    const s = '\x1b]0;title\x1b\\'
    expect(scanEscapeSequence(s, 0)).toBe(s.length)
  })

  it('parses DCS sequence', () => {
    const s = '\x1bPq\x1b\\'
    expect(scanEscapeSequence(s, 0)).toBe(s.length)
  })

  it('parses APC/PM/SOS sequences', () => {
    // APC = ESC _
    expect(scanEscapeSequence('\x1b_\x1b\\', 0)).toBe(4)
    // PM = ESC ^
    expect(scanEscapeSequence('\x1b^\x1b\\', 0)).toBe(4)
    // SOS = ESC X
    expect(scanEscapeSequence('\x1bX\x1b\\', 0)).toBe(4)
  })

  it('returns -1 for unterminated OSC', () => {
    expect(scanEscapeSequence('\x1b]0;title', 0)).toBe(-1)
  })

  it('parses charset select: ESC(0 (DEC special graphics)', () => {
    const s = '\x1b(0'
    expect(scanEscapeSequence(s, 0)).toBe(3)
  })

  it('parses charset select: ESC)B', () => {
    expect(scanEscapeSequence('\x1b)B', 0)).toBe(3)
  })

  it('parses single-byte sequences: ESC 7, ESC 8, ESC c, ESC M', () => {
    expect(scanEscapeSequence('\x1b7', 0)).toBe(2)
    expect(scanEscapeSequence('\x1b8', 0)).toBe(2)
    expect(scanEscapeSequence('\x1bc', 0)).toBe(2)
    expect(scanEscapeSequence('\x1bM', 0)).toBe(2)
  })
})

// ─── stripAnsi（无状态） ──────────────────────────────────────────────────────

describe('stripAnsi', () => {
  it('strips basic SGR: ESC[32m...ESC[0m', () => {
    expect(stripAnsi('\x1b[32mhello\x1b[0m')).toBe('hello')
  })

  it('strips OSC with BEL: ESC]0;title BEL', () => {
    expect(stripAnsi('\x1b]0;title\x07text')).toBe('text')
  })

  it('strips OSC with ST terminator', () => {
    expect(stripAnsi('\x1b]9001;payload\x1b\\output')).toBe('output')
  })

  it('strips DCS/PM/APC/SOS sequences', () => {
    expect(stripAnsi('\x1bPdata\x1b\\ok')).toBe('ok')
    expect(stripAnsi('\x1b^data\x1b\\ok')).toBe('ok')
    expect(stripAnsi('\x1b_data\x1b\\ok')).toBe('ok')
    expect(stripAnsi('\x1bXdata\x1b\\ok')).toBe('ok')
  })

  it('strips DEC private sequences: ESC[?25h', () => {
    expect(stripAnsi('\x1b[?25hvisible')).toBe('visible')
  })

  it('strips CSI with intermediate byte', () => {
    // ESC[ >1 q (modify cursor shape, with space intermediate = 0x20)
    expect(stripAnsi('\x1b[>1 qdone')).toBe('done')
  })

  it('preserves newlines, tabs, and backspace', () => {
    const input = 'line1\nline2\ttab'
    expect(stripAnsi(input)).toBe(input)
  })

  it('drops C0 control codes but preserves printable text', () => {
    // BEL (0x07) when not preceded by ESC — it's a C0 control, should be dropped
    expect(stripAnsi('before\x07after')).toBe('beforeafter')
    // SOH
    expect(stripAnsi('a\x01b')).toBe('ab')
  })

  it('drops DEL (0x7F)', () => {
    expect(stripAnsi('before\x7fafter')).toBe('beforeafter')
  })

  it('handles cross-boundary残缺：partial sequence at end is dropped', () => {
    expect(stripAnsi('text\x1b[')).toBe('text')
    expect(stripAnsi('text\x1b')).toBe('text')
  })

  it('handles mixed sequences and plain text', () => {
    const raw = '\x1b[1mBOLD\x1b[0m normal \x1b[32mgreen\x1b[0m done'
    expect(stripAnsi(raw)).toBe('BOLD normal green done')
  })

  it('does not leave visible escape chars', () => {
    // 这就是「乱码字符串」的直接测试
    const raw = '\x1b[32m✓\x1b[0m and \x1b[31m✗\x1b[0m'
    const result = stripAnsi(raw)
    expect(result).not.toMatch('\x1b')
    expect(result).toBe('✓ and ✗')
  })
})

// ─── createAnsiStripper（有状态跨块剥离） ────────────────────────────────────

describe('createAnsiStripper', () => {
  it('identical to stripAnsi for complete chunks', () => {
    const s = createAnsiStripper()
    const input = '\x1b[32mhello\x1b[0m'
    expect(s.push(input)).toBe(stripAnsi(input))
  })

  it('handles CSI split across two chunks', () => {
    const s = createAnsiStripper()
    expect(s.push('\x1b[')).toBe('')         // incomplete — held
    expect(s.push('32mhello')).toBe('hello')  // complete — stripped
  })

  it('handles OSC BEL split across chunks', () => {
    const s = createAnsiStripper()
    expect(s.push('before\x1b]0;ti')).toBe('before')
    expect(s.push('tle\x07after')).toBe('after')
  })

  it('handles OSC ST (ESC \\) split at the ESC', () => {
    const s = createAnsiStripper()
    expect(s.push('text\x1b')).toBe('text')
    expect(s.push('\\rest')).toBe('rest')
  })

  it('handles CSI split in the middle of params', () => {
    const s = createAnsiStripper()
    expect(s.push('a\x1b[3')).toBe('a')
    expect(s.push('2mb')).toBe('b')
  })

  it('discards oversized carry instead of growing unboundedly', () => {
    const s = createAnsiStripper()
    // A never-terminating escape sequence must not accumulate forever.
    const junk = '\x1b[' + '9'.repeat(5000)
    expect(s.push(junk)).toBe('')
    // Carry was dropped, so this chunk's leading bytes are now literal text —
    // acceptable degradation; the point is the stripper keeps working.
    expect(s.push('32mok')).toBe('32mok')
    // And a subsequent well-formed sequence is still stripped correctly.
    expect(s.push('\x1b[32mgreen\x1b[0m')).toBe('green')
  })

  it('handles many consecutive complete chunks', () => {
    const s = createAnsiStripper()
    expect(s.push('\x1b[32m')).toBe('')
    expect(s.push('hel')).toBe('hel')
    expect(s.push('lo')).toBe('lo')
    expect(s.push('\x1b[0m')).toBe('')
  })
})

// ─── renderTerminalText（CR/BS 覆写语义） ────────────────────────────────────

describe('renderTerminalText', () => {
  // CR 只是「回到行首」，不擦除。这是真实 xterm 行为：
  // 'downloading...\rdone!' 显示为 'done!oading...'（done! 覆写前 5 个字符）。
  // 进度条之所以干净，是因为它们在 CR 之后还发 ESC[K 擦掉行尾残留。
  it('CR moves cursor to column 0 and overwrites in place (no erase)', () => {
    expect(renderTerminalText('downloading...\rdone!')).toBe('done!oading...')
  })

  it('CR + EL(ESC[K) is the real progress-bar idiom — only last frame survives', () => {
    const raw = stripAnsi('downloading...\r\x1b[Kdone!')
    expect(renderTerminalText(raw)).toBe('done!')
  })

  it('overwrite is character-wise when new frame is longer', () => {
    expect(renderTerminalText('abc\rXYZW')).toBe('XYZW')
  })

  it('multiple CR frames overwrite from column 0 each time', () => {
    expect(renderTerminalText('step1\rstep2\rstep3')).toBe('step3')
  })

  it('BS moves cursor back one position', () => {
    expect(renderTerminalText('abc\x08d')).toBe('abd')
  })

  it('equal-length CR frames fully replace', () => {
    expect(renderTerminalText('AAAA\rBBBB')).toBe('BBBB')
  })

  it('mixed CR and newlines — CR scoped to its own line', () => {
    expect(renderTerminalText('line1\rOVERW\nline2')).toBe('OVERW\nline2')
  })

  it('handles CR at start of line (after newline)', () => {
    expect(renderTerminalText('first\n\rsecond')).toBe('first\nsecond')
  })

  it('progress bar scenario with EL: only the final frame remains', () => {
    const raw = stripAnsi(
      '[  1%] ##\r\x1b[K[ 50%] #########\r\x1b[K[100%] ###################'
    )
    expect(renderTerminalText(raw)).toBe('[100%] ###################')
  })

  it('pass-through when no CR, BS, or EL present', () => {
    const raw = 'normal output\nline 2'
    expect(renderTerminalText(raw)).toBe(raw)
  })

  it('multiple lines each with CR + EL', () => {
    const raw = stripAnsi('line1\r\x1b[KL1FINAL\nline2\r\x1b[KL2FINAL')
    expect(renderTerminalText(raw)).toBe('L1FINAL\nL2FINAL')
  })

  it('BS at position 0 is a no-op', () => {
    expect(renderTerminalText('\x08hello')).toBe('hello')
  })

  it('CR alone leaves the line content intact (cursor moved, nothing erased)', () => {
    expect(renderTerminalText('something\r')).toBe('something')
  })

  it('ESC[2K clears the whole line', () => {
    const raw = stripAnsi('garbage text\r\x1b[2Kclean')
    expect(renderTerminalText(raw)).toBe('clean')
  })

  it('ESC[1K erases from line start to cursor (replaced by spaces)', () => {
    // Write "abcdef", CR to col 0, advance to col 3 by writing "XYZ", then EL-to-start
    const raw = stripAnsi('abcdef\rXYZ\x1b[1K')
    expect(renderTerminalText(raw)).toBe('   def')
  })

  it('EL markers never leak into output as visible characters', () => {
    const raw = stripAnsi('abc\r\x1b[Kdef\x1b[2K\x1b[1K')
    const out = renderTerminalText(raw)
    expect(out).not.toMatch(/[\uE000-\uE002]/)
  })

  it('PUA marker chars present in real content are neutralized, not honored', () => {
    // 若不剔除，恶意/巧合的内容就能伪造擦除行为
    const out = renderTerminalText(stripAnsi('keep\uE000\uE002me'))
    expect(out).toBe('keepme')
  })
})

// ─── Integration: strip → render pipeline ─────────────────────────────────────

describe('pipeline: stripAnsi + renderTerminalText', () => {
  it('strips ANSI then applies CR + EL overwrite', () => {
    const raw = '\x1b[32mfirst attempt\x1b[0m\r\x1b[K\x1b[1;32msuccess!\x1b[0m'
    expect(renderTerminalText(stripAnsi(raw))).toBe('success!')
  })

  it('stateful stripper + render: cross-chunk ANSI, CR and EL', () => {
    const s = createAnsiStripper()
    // The CSI and the EL are both split across chunk boundaries.
    const part1 = s.push('\x1b[32mdoing...\r\x1b')
    const part2 = s.push('[K\x1b[1;3')
    const part3 = s.push('2mdone!\x1b[0m')
    expect(renderTerminalText(part1 + part2 + part3)).toBe('done!')
  })

  it('OSC sentinel is stripped cleanly (does not appear in output)', () => {
    const raw = 'before\x1b]9001;ADNIFY_CMD_START_xxx\x07after'
    expect(renderTerminalText(stripAnsi(raw))).toBe('beforeafter')
  })

  it('does not produce the "garbled string" the user reported', () => {
    // Simulated PTY output: mixed SGR, OSC, CR + EL
    const raw = [
      '\x1b[?25l',                         // hide cursor
      'npm WARN deprecated foo@1.0.0\n',
      '\x1b[Kadded 42 packages in \x1b[33m3.2s\x1b[0m\n',
      '\x1b[1m\x1b[32m✓\x1b[0m Done\n',
      '\x1b[?25h',                         // show cursor
    ].join('')
    const result = renderTerminalText(stripAnsi(raw))
    // No escape artifacts of any kind
    expect(result).not.toMatch('\x1b')
    expect(result).not.toMatch(/\[0m/)
    expect(result).not.toMatch(/\[32m/)
    expect(result).not.toMatch(/\[\?25[lh]/)
    // Meaningful content preserved
    expect(result).toContain('npm WARN deprecated foo@1.0.0')
    expect(result).toContain('added 42 packages in 3.2s')
    expect(result).toContain('✓ Done')
  })
})
