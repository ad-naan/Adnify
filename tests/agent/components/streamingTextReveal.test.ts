import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Element, Root, Text } from 'hast'
import {
  REVEAL_DURATION_MS,
  StreamingRevealTracker,
  assignRevealPhases,
  rehypeStreamingReveal,
  type RevealSegment,
} from '@renderer/components/agent/streamingTextReveal'

/** 相位按源码偏移算，所以手搓的树也得带上 position */
function at(start: number, end: number) {
  return {
    start: { line: 1, column: start + 1, offset: start },
    end: { line: 1, column: end + 1, offset: end },
  }
}

function textNode(value: string, start: number): Text {
  return { type: 'text', value, position: at(start, start + value.length) }
}

function element(tagName: string, children: Array<Element | Text>, className?: string): Element {
  return {
    type: 'element',
    tagName,
    properties: className ? { className: [className] } : {},
    children,
  }
}

function root(children: Array<Element | Text>, sourceLength: number): Root {
  return { type: 'root', children, position: at(0, sourceLength) }
}

function apply(tree: Root, segments: readonly RevealSegment[]): Root {
  rehypeStreamingReveal(segments)()(tree)
  return tree
}

/** 把树压成 `文字` / `[文字@延迟]` 的扁平串，断言时只关心切在哪、相位是多少 */
function outline(node: Root | Element): string {
  return node.children.map(child => {
    if (child.type === 'text') return child.value
    if (child.type !== 'element') return ''
    const style = child.properties?.style
    if (child.tagName === 'span' && typeof style === 'string') {
      return `[${(child.children[0] as Text).value}@${style}]`
    }
    return `<${child.tagName}>${outline(child)}</${child.tagName}>`
  }).join('')
}

describe('StreamingRevealTracker', () => {
  it('treats the first streaming frame as one freshly arrived batch', () => {
    const tracker = new StreamingRevealTracker()
    expect(tracker.update('你好', true, 1_000)).toEqual([{ length: 2, ageMs: 0 }])
  })

  it('settles history immediately so switching threads does not re-animate the screen', () => {
    const tracker = new StreamingRevealTracker()
    expect(tracker.update('一整条历史消息', false, 1_000)).toEqual([])
  })

  it('ages each append separately, oldest first', () => {
    const tracker = new StreamingRevealTracker()
    tracker.update('你的目标', true, 1_000)
    tracker.update('你的目标：', true, 1_033)
    expect(tracker.update('你的目标：手环', true, 1_066)).toEqual([
      { length: 4, ageMs: 66 },
      { length: 1, ageMs: 33 },
      { length: 2, ageMs: 0 },
    ])
  })

  it('drops batches that outlived the CSS animation', () => {
    const tracker = new StreamingRevealTracker()
    tracker.update('落定的部分', true, 1_000)
    const segments = tracker.update('落定的部分刚到', true, 1_000 + REVEAL_DURATION_MS)
    expect(segments).toEqual([{ length: 2, ageMs: 0 }])
  })

  it('does not re-count a re-render of the same content, but keeps ages moving forward', () => {
    const tracker = new StreamingRevealTracker()
    tracker.update('abc', true, 1_000)
    expect(tracker.update('abcde', true, 1_100)).toEqual([
      { length: 3, ageMs: 100 },
      { length: 2, ageMs: 0 },
    ])
    // 同一段内容再渲染一次（字号变了、父组件更新）：不能多记一笔，相位也不许往回跳
    expect(tracker.update('abcde', true, 1_200)).toEqual([
      { length: 3, ageMs: 200 },
      { length: 2, ageMs: 100 },
    ])
  })

  it('settles everything when the content is rewritten instead of appended', () => {
    const tracker = new StreamingRevealTracker()
    tracker.update('第一版内容', true, 1_000)
    expect(tracker.update('回滚后的内容', true, 1_010)).toEqual([])
  })

  it('reveals only what arrived after a message that mounted already settled', () => {
    const tracker = new StreamingRevealTracker()
    tracker.update('恢复出来的正文', false, 1_000)
    expect(tracker.update('恢复出来的正文，继续', true, 1_010)).toEqual([{ length: 3, ageMs: 0 }])
  })
})

describe('assignRevealPhases', () => {
  it('ramps the phase across a single batch instead of fading it as one block', () => {
    // 一次 flush 送来 5 个字：整批同相位会一起变实，看着一顿一顿的。
    // 按位置在「窗口边界(=已落定) → 刚到」之间插值，尾巴才是连续的。
    expect(assignRevealPhases('abcde', 0, [{ length: 5, ageMs: 0 }])).toEqual([
      { text: 'a' },
      { text: 'b', ageMs: 304 },
      { text: 'c', ageMs: 208 },
      { text: 'd', ageMs: 96 },
      { text: 'e', ageMs: 0 },
    ])
  })

  it('stitches batches together — the seam carries no jump', () => {
    expect(assignRevealPhases('你的目标：手环', 0, [{ length: 1, ageMs: 33 }, { length: 2, ageMs: 0 }])).toEqual([
      { text: '你的目标' },
      { text: '：手', ageMs: 32 },
      { text: '环', ageMs: 0 },
    ])
  })

  it('keeps the whole text settled when nothing is in flight', () => {
    expect(assignRevealPhases('已经写完了', 0, [])).toEqual([{ text: '已经写完了' }])
  })

  it('shifts the window by distanceOfLast — text that ends before the source does', () => {
    // 'ab' 后面还有 2 个字符（比如刚闭合的 `**`），最新的相位落在它们身上
    expect(assignRevealPhases('ab', 2, [{ length: 2, ageMs: 33 }, { length: 2, ageMs: 0 }])).toEqual([
      { text: 'a' },
      { text: 'b', ageMs: 32 },
    ])
  })

  it('only walks the tail — a long settled prefix comes back as one part', () => {
    const parts = assignRevealPhases('落定'.repeat(5_000) + 'ab', 0, [{ length: 2, ageMs: 0 }])
    expect(parts).toEqual([
      { text: '落定'.repeat(5_000) + 'a' },
      { text: 'b', ageMs: 0 },
    ])
  })

  it('does not cut a surrogate pair in half', () => {
    // 🚀 是一个代理对；切在低位代理上会渲染成两个乱码方块
    expect(assignRevealPhases('done 🚀', 0, [{ length: 4, ageMs: 0 }])).toEqual([
      { text: 'done' },
      { text: ' ', ageMs: 272 },
      { text: '🚀', ageMs: 128 },
    ])
  })
})

describe('rehypeStreamingReveal', () => {
  it('wraps the trailing batches in place, inside the block that owns them', () => {
    const tree = apply(root([element('p', [textNode('你的目标：手环', 0)])], 7), [
      { length: 1, ageMs: 33 },
      { length: 2, ageMs: 0 },
    ])
    expect(outline(tree)).toBe('<p>你的目标[：手@animation-delay:-32ms][环@animation-delay:-0ms]</p>')
  })

  it('does not re-fade settled text when an inline construct closes', () => {
    // 源码 `目标是 **手环**`：4 个星号不进渲染结果。按渲染长度累加窗口的话，最新那批会
    // 往前多吃 4 个字，把 t-66ms 就到了的「是 」重新淡入一遍 —— 肉眼看就是尾巴一抽。
    const tree = apply(
      root([element('p', [textNode('目标是 ', 0), element('strong', [textNode('手环', 6)])])], 10),
      [{ length: 3, ageMs: 66 }, { length: 3, ageMs: 33 }, { length: 4, ageMs: 0 }],
    )
    expect(outline(tree)).toBe(
      '<p>目[标@animation-delay:-240ms][是 @animation-delay:-64ms]'
      + '<strong>[手@animation-delay:-32ms][环@animation-delay:-16ms]</strong></p>',
    )
  })

  it('leaves code untouched — splitting it would break highlighting and copy', () => {
    // 源码 `见这个 \`foo.ts\``，行内代码占掉 8 个字符的窗口
    const tree = apply(
      root([element('p', [textNode('见这个 ', 0), element('code', [textNode('foo.ts', 5)])])], 12),
      [{ length: 4, ageMs: 33 }, { length: 8, ageMs: 0 }],
    )
    expect(outline(tree)).toBe(
      '<p>见[这@animation-delay:-288ms][个@animation-delay:-160ms][ @animation-delay:-32ms]'
      + '<code>foo.ts</code></p>',
    )
  })

  it('leaves katex output untouched — it parses formulas out of element text', () => {
    const tree = apply(
      root([element('p', [textNode('公式 ', 0), element('span', [textNode('E=mc^2', 4)], 'katex')])], 11),
      [{ length: 3, ageMs: 33 }, { length: 8, ageMs: 0 }],
    )
    expect(outline(tree)).toBe(
      '<p>公[式@animation-delay:-224ms][ @animation-delay:-32ms]<span>E=mc^2</span></p>',
    )
  })

  it('spreads one window across a block boundary', () => {
    // 源码 `ab\n\ncd`：窗口盖住 6 个字符，跨过了段落边界
    const tree = apply(
      root([
        element('p', [textNode('ab', 0)]),
        element('p', [textNode('cd', 4)]),
      ], 6),
      [{ length: 3, ageMs: 66 }, { length: 3, ageMs: 0 }],
    )
    expect(outline(tree)).toBe(
      '<p>a[b@animation-delay:-240ms]</p>'
      + '<p>[c@animation-delay:-32ms][d@animation-delay:-0ms]</p>',
    )
  })

  it('never touches blocks that end before the window starts', () => {
    // 窗口只有 2 个字符：前一段整棵子树连遍历都不该进
    const tree = apply(
      root([
        element('p', [textNode('ab', 0)]),
        element('p', [textNode('cd', 4)]),
      ], 6),
      [{ length: 2, ageMs: 0 }],
    )
    expect(outline(tree)).toBe('<p>ab</p><p>c[d@animation-delay:-0ms]</p>')
  })

  it('leaves a node alone when its source range does not match its text', () => {
    // `a&amp;b` 在源码里 7 个字符、渲染出来 3 个：偏移对不上，相位只会标错，不如不动
    const tree = apply(
      root([element('p', [{ type: 'text', value: 'a&b', position: at(0, 7) }])], 7),
      [{ length: 7, ageMs: 0 }],
    )
    expect(outline(tree)).toBe('<p>a&b</p>')
  })

  it('is a no-op once every batch has settled', () => {
    const tree = apply(root([element('p', [textNode('都写完了', 0)])], 4), [])
    expect(outline(tree)).toBe('<p>都写完了</p>')
  })
})

describe('reveal duration', () => {
  it('matches the CSS animation it drives', () => {
    const css = readFileSync(path.resolve(process.cwd(), 'src/renderer/styles/globals.css'), 'utf8')
    const declared = /\.stream-reveal\s*\{[^}]*animation:\s*stream-reveal\s+(\d+)ms/.exec(css)
    // 年龄是写成负 animation-delay 的，两个值一脱钩，尾巴上的相位就全错
    expect(declared?.[1]).toBe(String(REVEAL_DURATION_MS))
  })
})
