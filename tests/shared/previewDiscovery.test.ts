import { describe, expect, it } from 'vitest'
import {
  extractLocalPreviewOrigins,
  formatPreviewOriginLabel,
  isLocalPreviewUrl,
  parseLocalPreviewOrigin,
  stripAnsi,
} from '@shared/preview/discovery'

describe('parseLocalPreviewOrigin', () => {
  it('collapses localhost and 127.0.0.1 on the same port to one identity', () => {
    const viaName = parseLocalPreviewOrigin('http://localhost:5173/')
    const viaLoopback = parseLocalPreviewOrigin('http://127.0.0.1:5173/')

    expect(viaName?.key).toBe(viaLoopback?.key)
  })

  it('discards the path so HMR and asset URLs do not become new candidates', () => {
    const root = parseLocalPreviewOrigin('http://localhost:5173/')
    const asset = parseLocalPreviewOrigin('http://localhost:5173/node_modules/.vite/deps/react.js')

    expect(asset?.key).toBe(root?.key)
    expect(asset?.origin).toBe('http://127.0.0.1:5173')
  })

  it('rewrites the 0.0.0.0 listen address to a navigable loopback host', () => {
    expect(parseLocalPreviewOrigin('http://0.0.0.0:3000')?.origin).toBe('http://127.0.0.1:3000')
  })

  it('keeps http and https on the same port distinct', () => {
    expect(parseLocalPreviewOrigin('http://localhost:8443')?.key)
      .not.toBe(parseLocalPreviewOrigin('https://localhost:8443')?.key)
  })

  it('fills in the protocol default port when none is given', () => {
    expect(parseLocalPreviewOrigin('http://localhost')?.port).toBe(80)
    expect(parseLocalPreviewOrigin('https://localhost')?.port).toBe(443)
  })

  it('rejects non-local hosts', () => {
    expect(parseLocalPreviewOrigin('http://example.com:5173')).toBeNull()
    // 前缀伪装：localhost.evil.com 不是本机
    expect(parseLocalPreviewOrigin('http://localhost.evil.com/')).toBeNull()
    expect(parseLocalPreviewOrigin('http://127.0.0.1.evil.com/')).toBeNull()
  })

  it('rejects non-http protocols', () => {
    expect(parseLocalPreviewOrigin('file:///etc/passwd')).toBeNull()
    expect(parseLocalPreviewOrigin('ws://localhost:5173')).toBeNull()
    expect(parseLocalPreviewOrigin('javascript:alert(1)')).toBeNull()
    expect(parseLocalPreviewOrigin('not a url')).toBeNull()
  })

  it('gates isLocalPreviewUrl on the same rules', () => {
    expect(isLocalPreviewUrl('http://127.0.0.1:5173/foo')).toBe(true)
    expect(isLocalPreviewUrl('https://example.com')).toBe(false)
  })
})

describe('formatPreviewOriginLabel', () => {
  it('omits the port when it is the protocol default', () => {
    const origin = parseLocalPreviewOrigin('http://localhost')!
    expect(formatPreviewOriginLabel(origin)).toBe('localhost')
  })

  it('shows the port otherwise, using the host as printed', () => {
    expect(formatPreviewOriginLabel(parseLocalPreviewOrigin('http://localhost:5173')!)).toBe('localhost:5173')
    expect(formatPreviewOriginLabel(parseLocalPreviewOrigin('http://127.0.0.1:3000')!)).toBe('127.0.0.1:3000')
  })
})

describe('extractLocalPreviewOrigins', () => {
  it('yields one candidate per port from a noisy vite log', () => {
    const log = [
      '  VITE v5.4.0  ready in 412 ms',
      '  ➜  Local:   http://localhost:5173/',
      '  ➜  Network: http://127.0.0.1:5173/',
      '4:12:03 PM [vite] hmr update /src/App.tsx',
      'GET http://localhost:5173/src/main.tsx 200',
      'GET http://localhost:5173/@vite/client 200',
      'GET http://localhost:5173/node_modules/.vite/deps/react.js 200',
      'error at http://localhost:5173/src/App.tsx:12:3',
    ].join('\n')

    // 这是原来弹窗反复闪出的根因：同一个 5173 在这段日志里出现 6 次不同 URL。
    expect(extractLocalPreviewOrigins(log).map((origin) => origin.origin)).toEqual(['http://127.0.0.1:5173'])
  })

  it('keeps genuinely different ports apart', () => {
    const log = 'api on http://localhost:3000 and web on http://localhost:5173'
    expect(extractLocalPreviewOrigins(log).map((origin) => origin.port)).toEqual([3000, 5173])
  })

  it('does not swallow trailing punctuation into the URL', () => {
    expect(extractLocalPreviewOrigins('open (http://localhost:4321/) now')[0].origin)
      .toBe('http://127.0.0.1:4321')
  })

  it('ignores remote URLs in the same output', () => {
    const log = 'deployed to https://example.com/app, local at http://localhost:8080/'
    expect(extractLocalPreviewOrigins(log).map((origin) => origin.port)).toEqual([8080])
  })

  it('returns nothing when there is no local hint', () => {
    expect(extractLocalPreviewOrigins('npm warn something happened')).toEqual([])
    expect(extractLocalPreviewOrigins('')).toEqual([])
  })

  it('finds URLs wrapped in ANSI colour codes', () => {
    const colored = '  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:5173/\x1b[39m'
    expect(extractLocalPreviewOrigins(stripAnsi(colored)).map((origin) => origin.origin))
      .toEqual(['http://127.0.0.1:5173'])
  })
})

describe('stripAnsi', () => {
  it('removes SGR sequences and OSC title sequences', () => {
    expect(stripAnsi('\x1b[1;32mready\x1b[0m')).toBe('ready')
    expect(stripAnsi('\x1b]0;window title\x07text')).toBe('text')
  })
})
