import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import {
  rehypeStreamingReveal,
  type RevealSegment,
} from '@renderer/components/agent/streamingTextReveal'

/** 走真实的 react-markdown 管道，确认位置映射、style 字符串、行内位置都对得上 */
function render(content: string, segments: readonly RevealSegment[]): string {
  return renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex, rehypeStreamingReveal(segments)]}
      skipHtml
    >
      {content}
    </ReactMarkdown>,
  )
}

describe('streaming reveal through react-markdown', () => {
  it('puts the write head inside the paragraph, as a real style attribute', () => {
    expect(render('你的目标：手环', [{ length: 1, ageMs: 66 }, { length: 2, ageMs: 0 }])).toBe(
      '<p>你的目标'
      + '<span class="stream-reveal" style="animation-delay:-64ms">：手</span>'
      + '<span class="stream-reveal" style="animation-delay:-0ms">环</span>'
      + '</p>',
    )
  })

  it('still resolves markdown at the write head — no flash of raw ** before it turns bold', () => {
    expect(render('目标是 **手环**', [{ length: 2, ageMs: 33 }, { length: 2, ageMs: 0 }])).toBe(
      '<p>目标是 <strong>手'
      + '<span class="stream-reveal" style="animation-delay:-32ms">环</span>'
      + '</strong></p>',
    )
  })

  it('does not reach into code or math', () => {
    expect(render('见这个 `foo.ts`', [{ length: 4, ageMs: 33 }, { length: 8, ageMs: 0 }])).toBe(
      '<p>见<span class="stream-reveal" style="animation-delay:-288ms">这</span>'
      + '<span class="stream-reveal" style="animation-delay:-160ms">个</span>'
      + '<span class="stream-reveal" style="animation-delay:-32ms"> </span>'
      + '<code>foo.ts</code></p>',
    )
    const math = render('公式 $a+b$', [{ length: 3, ageMs: 33 }, { length: 5, ageMs: 0 }])
    expect(math).toContain('katex')
    expect(math).not.toContain('stream-reveal">a')
  })

  it('leaves settled content completely alone', () => {
    expect(render('全都写完了', [])).toBe('<p>全都写完了</p>')
  })
})
