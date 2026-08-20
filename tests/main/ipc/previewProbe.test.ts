import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn(async () => {}) },
  ipcMain: { handle: vi.fn() },
  app: { isPackaged: false },
}))

import { probeLocalPreview } from '@main/ipc/preview'

let server: Server
let port: number
/** 每个路径的响应由测试逐个设置。 */
let respond: (url: string, res: import('http').ServerResponse) => void

beforeAll(async () => {
  server = createServer((req, res) => respond(req.url || '/', res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('probeLocalPreview', () => {
  it('reports an HTML dev server as reachable and lifts its title', async () => {
    respond = (_url, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<!doctype html><html><head><title>  My Dev App  </title></head><body>hi</body></html>')
    }

    const result = await probeLocalPreview(`http://127.0.0.1:${port}/`)
    expect(result.ok).toBe(true)
    expect(result.title).toBe('My Dev App')
    expect(result.resolvedUrl).toBe(`http://127.0.0.1:${port}`)
  })

  it('treats a 404 root as reachable — dev servers often only serve sub-routes', async () => {
    respond = (_url, res) => {
      res.writeHead(404, { 'Content-Type': 'text/html' })
      res.end('<html><body>Cannot GET /</body></html>')
    }

    const result = await probeLocalPreview(`http://127.0.0.1:${port}/`)
    expect(result.ok).toBe(true)
    expect(result.statusCode).toBe(404)
  })

  it('rejects a JSON API so it does not show up as a previewable site', async () => {
    respond = (_url, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    }

    const result = await probeLocalPreview(`http://127.0.0.1:${port}/`)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Not an HTML server')
  })

  it('stops reading once the title is in hand instead of draining an endless stream', async () => {
    respond = (_url, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.write('<html><head><title>Streamer</title></head><body>')
      // 永不结束的响应体，模拟 dev server 的 SSE / 长轮询端点
      const timer = setInterval(() => res.write('x'.repeat(1024)), 5)
      res.on('close', () => clearInterval(timer))
    }

    const result = await probeLocalPreview(`http://127.0.0.1:${port}/`, 4000)
    expect(result.ok).toBe(true)
    expect(result.title).toBe('Streamer')
  })

  it('refuses non-local addresses', async () => {
    for (const url of ['https://example.com', 'http://169.254.169.254/latest/meta-data', 'file:///etc/passwd']) {
      const result = await probeLocalPreview(url)
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Only local addresses can be probed')
    }
  })

  it('reports a closed port as unreachable rather than hanging', async () => {
    // 端口 1 上不会有监听者
    const result = await probeLocalPreview('http://127.0.0.1:1/', 500)
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})
