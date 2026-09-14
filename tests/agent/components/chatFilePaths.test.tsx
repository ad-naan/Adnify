import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { parseChatFilePath, parseChatFileHref, resolveChatFilePath, remarkChatFilePaths } from '@renderer/components/agent/chatFilePaths'

describe('chat file path recognition', () => {
  it.each([
    ['patches/pms-price-display-patch-20260914.zip', 'patches/pms-price-display-patch-20260914.zip'],
    ['C:\\Project\\发布 包.zip', 'C:/Project/发布 包.zip'],
    ['\\\\server\\share\\a.zip', '//server/share/a.zip'],
    ['file:///C:/My%20Files/a.zip', 'C:/My Files/a.zip'],
    ['/tmp/a.ts:12:3', '/tmp/a.ts'],
    ['src/app.ts#L12', 'src/app.ts'],
    ['package.json', 'package.json'],
    ['中文补丁.zip', '中文补丁.zip'],
    ['.env', '.env'],
    ['src/components/', 'src/components/'],
  ])('recognizes %s', (value, expected) => {
    expect(parseChatFilePath(value)).toBe(expected)
  })

  it.each(['https://example.com/a.zip', 'mailto:a@b.com', 'javascript:alert(1)', 'data:text/plain,a', 'asset://abc', 'adnify://agent/thread/a', 'a / b', 'fetch("/api")', 'npm/test()', '--output=dist/a.zip', 'C:relative.zip', 'hello world', 'x.y', 'a/\u0000b', 'a'.repeat(3000)])('ignores non-path %s', value => {
    expect(parseChatFilePath(value)).toBeNull()
  })

  it('resolves relative paths lexically without losing drive or UNC roots', () => {
    expect(resolveChatFilePath('./patches/../dist/a.zip', 'E:\\Project\\app')).toBe('E:/Project/app/dist/a.zip')
    expect(resolveChatFilePath('C:\\other\\a.zip', 'E:/app')).toBe('C:/other/a.zip')
    expect(resolveChatFilePath('\\\\server\\share\\a.zip', 'E:/app')).toBe('//server/share/a.zip')
    expect(resolveChatFilePath('a.zip', null)).toBeNull()
    expect(resolveChatFilePath('/tmp/a.zip', null)).toBe('/tmp/a.zip')
  })

  it('decodes Markdown destinations while preserving protocol-relative web links and literal code paths', () => {
    expect(parseChatFileHref('patches/my%20patch.zip')).toBe('patches/my patch.zip')
    expect(parseChatFileHref('//example.com/a.zip')).toBeNull()
    expect(parseChatFileHref('javascript%3Aalert(1)')).toBeNull()
    expect(parseChatFileHref('patches/a%00.zip')).toBeNull()
    expect(parseChatFilePath('patches/a%20.zip')).toBe('patches/a%20.zip')
  })

  it('links prose once while leaving code, existing links and URLs alone', () => {
    const html = renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkChatFilePaths]}>
      {'下载：patches/a.zip，修改 src/app.ts。\n\n`src/inline.ts`\n\n```ts\nsrc/code.ts\n```\n\n[existing](src/a.ts) https://example.com/a.zip'}
    </ReactMarkdown>)
    expect(html).toContain('href="patches/a.zip"')
    expect(html).toContain('href="src/app.ts"')
    expect(html).toContain('<code>src/inline.ts</code>')
    expect(html).not.toContain('href="src/code.ts"')
    expect(html.match(/<a /g)).toHaveLength(3)
    expect(html).toContain('https://example.com/a.zip')
  })

  it('bounds added links and scanning for very long blocks', () => {
    const tree = { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'src/a.ts '.repeat(100_000) }] }] }
    remarkChatFilePaths()(tree)
    const children = tree.children[0].children
    expect(children.filter(node => node.type === 'link')).toHaveLength(128)
    expect(children.at(-1)?.value?.length).toBeGreaterThan(800_000)
  })
})
