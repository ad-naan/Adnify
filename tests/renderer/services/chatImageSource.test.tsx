import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { chatMarkdownUrlTransform, parseChatImageSource, resolveChatImageSource } from '@renderer/services/chatImageSource'

const request = vi.hoisted(() => vi.fn())
vi.mock('@services/assetService', () => ({ assetService: { request } }))
beforeEach(() => { request.mockReset() })

describe('chat image references', () => {
  it.each([
    ['.adnify/assets/poster.png', '.adnify/assets/poster.png'],
    ['D:/project/图 片.png', 'D:/project/图 片.png'],
    ['D:\\project\\poster.png', 'D:/project/poster.png'],
    ['file:///D:/project/%E5%9B%BE%20%E7%89%87.png', 'D:/project/图 片.png'],
    ['file:///project/poster.png', '/project/poster.png'],
    ['images/a%23b.png?preview=1', 'images/a#b.png'],
  ])('resolves %s as a local reference, not a page-relative URL', (source, path) => {
    expect(parseChatImageSource(source)).toEqual({ type: 'path', path })
    expect(chatMarkdownUrlTransform(source, 'src', { tagName: 'img' })).toBe(source)
  })

  it.each([
    'javascript:alert(1)', 'data:text/html;base64,WA==', 'data:image/svg+xml;base64,WA==',
    'file://server/share/image.png', '//server/share/image.png', '\\\\server\\share\\image.png',
    'C:relative.png', 'C:/image.png:secret.png', 'image%00.png', 'image%0a.png',
    'bad%zz.png', 'file:///C:/a%5cb%00.png', 'asset://../secret', 'asset://', 'adnify-asset://token/media',
  ])('rejects unsafe or unsupported image reference %s', source => {
    expect(parseChatImageSource(source)).toBeNull()
    expect(chatMarkdownUrlTransform(source, 'src', { tagName: 'img' })).toBe('')
  })

  it.each([0x00, 0x09, 0x0a, 0x1f, 0x7f])('rejects literal and encoded control character %i in image paths', code => {
    const character = String.fromCharCode(code)
    for (const source of [`images/a${character}b.png`, `images/a${encodeURIComponent(character)}b.png`]) {
      expect(parseChatImageSource(source)).toBeNull()
      expect(chatMarkdownUrlTransform(source, 'src', { tagName: 'img' })).toBe('')
    }
  })

  it('preserves stable asset IDs and safe inline raster images', () => {
    expect(parseChatImageSource('asset://image-1')).toEqual({ type: 'asset', id: 'image-1' })
    const url = 'data:image/png;base64,WA=='
    expect(parseChatImageSource(url)).toEqual({ type: 'url', url })
  })

  it('keeps the default link sanitizer and thread links unchanged', () => {
    for (const source of ['asset://image-1', 'file:///D:/poster.png', 'D:/poster.png', 'javascript:alert(1)']) {
      expect(chatMarkdownUrlTransform(source, 'href', { tagName: 'a' })).toBe('')
    }
    expect(chatMarkdownUrlTransform('adnify://agent/thread/abc', 'href', { tagName: 'a' })).toBe('adnify://agent/thread/abc')
  })

  it('passes a Windows or asset source through the real Markdown renderer only to the image component', () => {
    const seen: string[] = []
    const html = renderToStaticMarkup(<ReactMarkdown urlTransform={chatMarkdownUrlTransform} components={{ img: ({ src }) => { seen.push(src || ''); return <span>preview</span> } }}>
      {'![poster](D:/project/poster.png)\n\n![asset](asset://image-1)\n\n[link](file:///D:/project/poster.png)'}
    </ReactMarkdown>)
    expect(seen).toEqual(['D:/project/poster.png', 'asset://image-1'])
    expect(html).not.toContain('<img')
    expect(html).not.toContain('href="file:')
  })
})

describe('chat image loading', () => {
  it('uses the authorized asset preview endpoint for stable IDs', async () => {
    request.mockResolvedValue('data:image/webp;base64,WA==')
    expect(await resolveChatImageSource('asset://image-1')).toBe('data:image/webp;base64,WA==')
    expect(request).toHaveBeenCalledWith({ type: 'preview', id: 'image-1' })
  })

  it('sends decoded local paths to the main process, never to a native image URL', async () => {
    request.mockResolvedValue('data:image/webp;base64,WA==')
    await resolveChatImageSource('file:///D:/project/a%20b.png')
    expect(request).toHaveBeenCalledWith({ type: 'previewPath', path: 'D:/project/a b.png' })
  })

  it('does not issue filesystem requests for remote images or rejected references', async () => {
    expect(await resolveChatImageSource('https://example.test/image.png')).toBe('https://example.test/image.png')
    await expect(resolveChatImageSource('javascript:bad')).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })

  it('propagates missing, unauthorized and non-image results to the UI fallback', async () => {
    request.mockResolvedValue(null)
    await expect(resolveChatImageSource('asset://missing')).rejects.toThrow('unavailable')
    request.mockRejectedValue(new Error('Image is outside the workspace'))
    await expect(resolveChatImageSource('../outside.png')).rejects.toThrow('outside')
  })
})
