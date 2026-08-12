/**
 * truncateToolResult 测试
 *
 * 关注点是「截断不能制造乱码」。工具结果里出现非 BMP 字符（emoji、部分 CJK
 * 扩展区汉字）时，JS 的 slice 按 UTF-16 code unit 切，可能刚好切在代理对
 * (surrogate pair) 中间，留下一个孤立的高位或低位代理。那半个字符在 UI 上渲染
 * 成 U+FFFD（),也会以 \ud800 之类的形式进到发给模型的 tool 消息里 —— 正是
 * 「拿到一坨乱码」的一种成因。
 */
import { describe, it, expect } from 'vitest'
import { truncateToolResult } from '@renderer/utils/partialJson'

/** 是否含有孤立代理（即被切坏的半个字符） */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      // 高位代理：后面必须紧跟低位代理
      const next = s.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      i++ // 跳过配对的低位
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // 走到这里说明这个低位代理前面没有高位代理
      return true
    }
  }
  return false
}

describe('truncateToolResult — 不能切出半个字符', () => {
  it('纯 emoji 长文本：任何截断位置都不产生孤立代理', () => {
    // 每个 emoji 占 2 个 code unit，没有换行 —— 行边界回退失效，
    // 必然走到 slice(0, headSize) 这条路，headSize 是奇数时正中代理对。
    const text = '😀'.repeat(20000)
    const out = truncateToolResult(text, 'default')

    expect(out.length).toBeLessThan(text.length)
    expect(hasLoneSurrogate(out)).toBe(false)
  })

  it('run_command 的头尾比例下也不产生孤立代理', () => {
    // run_command 是 headRatio 0.2 / tailRatio 0.75，尾部占大头，
    // 覆盖 slice(-tailSize) 这条独立的路径。
    const text = '🚀'.repeat(20000)
    const out = truncateToolResult(text, 'run_command')

    expect(hasLoneSurrogate(out)).toBe(false)
  })

  it('emoji 与 ASCII 混排、无换行时也安全', () => {
    // 让代理对落在各种奇偶位置上：ASCII 前缀长度逐个变化，
    // 总有一次会把 headSize/tailSize 顶到代理对中间。
    for (let pad = 0; pad < 8; pad++) {
      const text = 'x'.repeat(pad) + '🎉'.repeat(20000)
      const out = truncateToolResult(text, 'default')
      expect(hasLoneSurrogate(out), `pad=${pad}`).toBe(false)
    }
  })

  it('CJK 扩展区（非 BMP 汉字）同样安全', () => {
    // U+20000 𠀀，也是代理对，不只是 emoji 会踩
    const text = '\u{20000}'.repeat(20000)
    const out = truncateToolResult(text, 'default')
    expect(hasLoneSurrogate(out)).toBe(false)
  })

  it('有换行的内容走行边界，仍然不产生孤立代理', () => {
    const line = '😀'.repeat(50)
    const text = Array.from({ length: 500 }, () => line).join('\n')
    const out = truncateToolResult(text, 'default')
    expect(hasLoneSurrogate(out)).toBe(false)
  })
})

describe('truncateToolResult — 原有行为不能被破坏', () => {
  it('短于上限时原样返回', () => {
    const text = 'hello world'
    expect(truncateToolResult(text, 'default')).toBe(text)
  })

  it('空字符串返回空', () => {
    expect(truncateToolResult('', 'default')).toBe('')
  })

  it('超长时插入截断说明，且保留头尾', () => {
    const text = 'A'.repeat(5000) + '\n' + 'M'.repeat(20000) + '\n' + 'Z'.repeat(5000)
    const out = truncateToolResult(text, 'default')

    expect(out).toContain('truncated')
    expect(out).toContain('chars omitted')
    expect(out.startsWith('A')).toBe(true)
    expect(out.endsWith('Z')).toBe(true)
    expect(out.length).toBeLessThan(text.length)
  })

  it('显式 maxLength 覆盖配置', () => {
    const text = 'A'.repeat(10000)
    const out = truncateToolResult(text, 'default', 1000)
    // 截断说明本身有长度，这里只断言远小于原文且确实截了
    expect(out.length).toBeLessThan(2000)
    expect(out).toContain('truncated')
  })

  it('ASCII 内容的截断结果不含替换字符', () => {
    const text = 'line of text\n'.repeat(5000)
    const out = truncateToolResult(text, 'default')
    expect(out).not.toContain('�')
  })
})
