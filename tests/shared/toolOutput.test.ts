/**
 * 工具输出边界测试
 *
 * 这一层的两个不变量：
 *   1. 文本收敛不能制造乱码。非 BMP 字符（emoji、CJK 扩展区）在 JS 里占两个
 *      code unit，切在中间会留下孤立代理，渲染成 U+FFFD 并原样进到发给模型的
 *      tool 消息里 —— 「工具结果里一坨乱码」的成因之一。
 *   2. 结构化收敛的产物永远可以 JSON.parse。这是 boundJsonOutput 存在的全部理由：
 *      裸截断会把 JSON 切成语法残骸，模型和 UI 两头都解析失败。
 */
import { describe, expect, it } from 'vitest'
import {
  boundJsonOutput,
  boundTextOutput,
  clampOutputBudget,
  replaceOversizedJsonOutput,
} from '@shared/utils/toolOutput'

/** 是否含有孤立代理（即被切坏的半个字符） */
function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index++
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

describe('clampOutputBudget', () => {
  it('把非法或过小的配置抬到下限', () => {
    expect(clampOutputBudget(undefined)).toBe(1000)
    expect(clampOutputBudget(0)).toBe(1000)
    expect(clampOutputBudget(-5)).toBe(1000)
    expect(clampOutputBudget(NaN)).toBe(1000)
    expect(clampOutputBudget(50)).toBe(1000)
  })

  it('尊重用户配置的正常取值', () => {
    expect(clampOutputBudget(10000)).toBe(10000)
    expect(clampOutputBudget(10000.7)).toBe(10000)
  })
})

describe('boundTextOutput — 不能切出半个字符', () => {
  it('纯 emoji 长文本：任何截断位置都不产生孤立代理', () => {
    // 每个 emoji 占 2 个 code unit，没有换行 —— 行边界回退失效，
    // 必然走到硬切那条路，headSize 是奇数时正中代理对。
    const text = '😀'.repeat(20000)
    const out = boundTextOutput(text, 10000)

    expect(out.length).toBeLessThan(text.length)
    expect(hasLoneSurrogate(out)).toBe(false)
  })

  it('tail 信号的头尾比例下也不产生孤立代理', () => {
    // signal='tail' 是 0.2/0.75，尾部占大头，覆盖尾部切片这条独立路径。
    const text = '🚀'.repeat(20000)
    expect(hasLoneSurrogate(boundTextOutput(text, 10000, 'tail'))).toBe(false)
  })

  it('emoji 与 ASCII 混排、无换行时也安全', () => {
    // 让代理对落在各种奇偶位置上：ASCII 前缀长度逐个变化，
    // 总有一次会把 headSize/tailSize 顶到代理对中间。
    for (let pad = 0; pad < 8; pad++) {
      const text = 'x'.repeat(pad) + '🎉'.repeat(20000)
      expect(hasLoneSurrogate(boundTextOutput(text, 10000)), `pad=${pad}`).toBe(false)
    }
  })

  it('CJK 扩展区（非 BMP 汉字）同样安全', () => {
    // U+20000 𠀀，也是代理对，不只是 emoji 会踩
    expect(hasLoneSurrogate(boundTextOutput('\u{20000}'.repeat(20000), 10000))).toBe(false)
  })

  it('有换行的内容走行边界，仍然不产生孤立代理', () => {
    const text = Array.from({ length: 500 }, () => '😀'.repeat(50)).join('\n')
    expect(hasLoneSurrogate(boundTextOutput(text, 10000))).toBe(false)
  })
})

describe('boundTextOutput — 收敛行为', () => {
  it('短于预算时原样返回', () => {
    expect(boundTextOutput('hello world', 10000)).toBe('hello world')
  })

  it('空字符串返回空', () => {
    expect(boundTextOutput('', 10000)).toBe('')
  })

  it('超长时插入截断说明，且保留头尾', () => {
    const text = `${'A'.repeat(5000)}\n${'M'.repeat(20000)}\n${'Z'.repeat(5000)}`
    const out = boundTextOutput(text, 10000)

    expect(out).toContain('chars omitted')
    expect(out.startsWith('A')).toBe(true)
    expect(out.endsWith('Z')).toBe(true)
    expect(out.length).toBeLessThan(text.length)
  })

  it('signal=head 保留开头，signal=tail 保留结尾', () => {
    const text = `${'HEAD'.repeat(4000)}\n${'TAIL'.repeat(4000)}`
    const head = boundTextOutput(text, 4000, 'head')
    const tail = boundTextOutput(text, 4000, 'tail')

    // head 模式给开头 85%，tail 模式只给 20%，所以头部保留量必然差一截。
    expect(head.indexOf('chars omitted')).toBeGreaterThan(tail.indexOf('chars omitted'))
  })

  it('不再按内容猜比例：提到 error 的源文件仍然从头保留', () => {
    // 旧实现会正则匹配 /error|exception|failed/ 并把比例翻成 0.25/0.7，
    // 结果一个恰好提到 error 的源文件被从开头砍掉。
    const text = `${'const first = 1\n'.repeat(2000)}// handles error cases\n${'const last = 2\n'.repeat(2000)}`
    const out = boundTextOutput(text, 4000, 'head')

    expect(out.startsWith('const first = 1')).toBe(true)
    expect(out.indexOf('chars omitted')).toBeGreaterThan(out.length * 0.5)
  })
})

describe('boundJsonOutput', () => {
  const bigSymbols = Array.from({ length: 60 }, (_, index) => ({
    namePath: `Handler/handle_${index}`,
    kind: 'Method',
    range: `${index * 10}:1-${index * 10 + 40}:2`,
    body: `function handle() {\n${'  doSomething()\n'.repeat(12)}}`,
  }))

  it('第一级就塞得下时原样返回，不贴降级标记', () => {
    const out = boundJsonOutput([
      { build: () => ({ count: 1, items: ['a'] }) },
      { build: () => ({ count: 1 }), hint: 'never used' },
    ], 10000)

    expect(JSON.parse(out)).toEqual({ count: 1, items: ['a'] })
    expect(out).not.toContain('truncated')
  })

  it('超预算时降到下一级，并且结果仍然是合法 JSON', () => {
    const out = boundJsonOutput([
      { build: () => ({ matchedCount: 60, symbols: bigSymbols }) },
      {
        build: () => ({ matchedCount: 60, symbols: bigSymbols.map(({ body: _body, ...rest }) => rest) }),
        hint: 'Bodies were omitted.',
      },
    ], 10000)

    const parsed = JSON.parse(out) as Record<string, any>
    expect(parsed.matchedCount).toBe(60)
    expect(parsed.truncated).toBe(true)
    expect(parsed.truncationNotice).toBe('Bodies were omitted.')
    expect(parsed.symbols[0].body).toBeUndefined()
    expect(out.length).toBeLessThanOrEqual(10000)
  })

  it('逐级下降直到塞得进预算', () => {
    const out = boundJsonOutput([
      { build: () => ({ symbols: bigSymbols }), },
      { build: () => ({ symbols: bigSymbols.map(({ body: _body, ...rest }) => rest) }), hint: 'no bodies' },
      { build: () => ({ namePaths: bigSymbols.map(symbol => symbol.namePath) }), hint: 'names only' },
    ], 2000)

    const parsed = JSON.parse(out) as Record<string, any>
    expect(parsed.namePaths).toHaveLength(60)
    expect(parsed.truncationNotice).toBe('names only')
  })

  it('所有级别都塞不下时返回可解析的兜底信封', () => {
    const out = boundJsonOutput([
      { build: () => ({ symbols: bigSymbols }) },
      { build: () => ({ symbols: bigSymbols }), hint: 'still too big' },
    ], 1000)

    const parsed = JSON.parse(out) as Record<string, any>
    expect(parsed.truncated).toBe(true)
    expect(parsed.truncationNotice).toContain('Narrow the query scope')
    expect(parsed.symbols).toBeUndefined()
  })

  it('数组载荷被包成对象后仍可解析', () => {
    const out = boundJsonOutput([
      { build: () => bigSymbols },
      { build: () => bigSymbols.map(symbol => symbol.namePath), hint: 'names only' },
    ], 1500)

    const parsed = JSON.parse(out) as Record<string, any>
    expect(parsed.truncated).toBe(true)
    expect(Array.isArray(parsed.result)).toBe(true)
  })

  it('不做 pretty-print：缩进对模型没有价值', () => {
    const out = boundJsonOutput([{ build: () => ({ a: 1, b: 2 }) }], 10000)
    expect(out).toBe('{"a":1,"b":2}')
  })
})

describe('replaceOversizedJsonOutput', () => {
  it('返回合法 JSON 而不是被切开的残骸', () => {
    const out = replaceOversizedJsonOutput(50000, 10000)
    const parsed = JSON.parse(out) as Record<string, any>

    expect(parsed.truncated).toBe(true)
    expect(parsed.truncationNotice).toContain('50000')
    expect(parsed.truncationNotice).toContain('10000')
  })
})
