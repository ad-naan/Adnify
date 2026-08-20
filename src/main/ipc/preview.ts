/**
 * 本地预览服务探活 IPC。
 *
 * 为什么不复用 `http:readUrl`：那条路径会先把 URL 交给 r.jina.ai 抓取，
 * 也就是把用户的内网地址发到第三方服务；对 localhost 还必然失败后再回退。
 * 这里只允许本机地址，直连、限时、只读响应头 + 极少量正文。
 */

import { logger } from '@shared/utils/Logger'
import { isLocalPreviewUrl, parseLocalPreviewOrigin } from '@shared/preview/discovery'
import type { PreviewProbeResult } from '@shared/types/preview'
import { openExternalSafely } from '../security/externalUrl'
import { safeIpcHandle } from './safeHandle'

/** 只需要够读到 <title>。dev server 首屏 HTML 通常几 KB。 */
const MAX_PROBE_BYTES = 64 * 1024
const DEFAULT_PROBE_TIMEOUT = 1500
const MAX_PROBE_TIMEOUT = 5000

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const title = match?.[1]?.trim()
  return title || undefined
}

/**
 * 读取至多 MAX_PROBE_BYTES 后主动断开。
 *
 * dev server 的 SSE / 长轮询端点不会自己结束响应，整体读取会一直挂到超时，
 * 所以这里按块读并在够用时 cancel。
 */
async function readCapped(response: Response): Promise<string> {
  const body = response.body
  if (!body) return ''

  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let text = ''
  let received = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      text += decoder.decode(value, { stream: true })
      if (received >= MAX_PROBE_BYTES || /<\/title>/i.test(text)) break
    }
  } finally {
    await reader.cancel().catch(() => {})
  }

  return text
}

async function probeOnce(url: string, timeoutMs: number): Promise<PreviewProbeResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      // 有些框架（Nuxt/Remix）对 HEAD 返回 405，GET 才是可靠信号。
      method: 'GET',
      redirect: 'follow',
      headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      signal: controller.signal,
    })

    const contentType = response.headers.get('content-type') || undefined
    const isHtml = !contentType
      || contentType.includes('text/html')
      || contentType.includes('application/xhtml+xml')

    // 服务在监听就算"活着" —— dev server 的根路径给 404 也照样能预览子路由。
    // 只有非 HTML 响应（纯 API、图片服务）才不值得放进预览候选。
    if (!isHtml) {
      return {
        ok: false,
        statusCode: response.status,
        contentType,
        error: `Not an HTML server (${contentType})`,
      }
    }

    const html = await readCapped(response)
    return {
      ok: true,
      statusCode: response.status,
      contentType,
      title: extractTitle(html),
      resolvedUrl: url,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      error: controller.signal.aborted ? `Probe timed out after ${timeoutMs}ms` : message,
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function probeLocalPreview(url: string, timeout?: number): Promise<PreviewProbeResult> {
  const origin = parseLocalPreviewOrigin(url)
  if (!origin) {
    return { ok: false, error: 'Only local addresses can be probed' }
  }

  const timeoutMs = Math.min(
    Math.max(typeof timeout === 'number' && timeout > 0 ? timeout : DEFAULT_PROBE_TIMEOUT, 200),
    MAX_PROBE_TIMEOUT,
  )

  const first = await probeOnce(origin.origin, timeoutMs)
  if (first.ok || first.statusCode !== undefined) {
    // statusCode 存在说明连上了（只是内容类型不合），不需要换主机重试。
    return first
  }

  // 只监听 ::1 的服务（Node 在某些平台上 `listen(port)` 的默认行为）用
  // 127.0.0.1 连不上。换 localhost 再试一次 —— 它会同时解析 A 和 AAAA 记录。
  const fallbackUrl = `${origin.protocol}//localhost:${origin.port}`
  if (fallbackUrl === origin.origin) {
    return first
  }

  const second = await probeOnce(fallbackUrl, timeoutMs)
  return second.ok ? second : first
}

export function registerPreviewHandlers(): void {
  safeIpcHandle('preview:probe', async (_event, url: string, timeout?: number) => {
    if (typeof url !== 'string' || !isLocalPreviewUrl(url)) {
      return { ok: false, error: 'Only local addresses can be probed' } satisfies PreviewProbeResult
    }
    return probeLocalPreview(url, timeout)
  }, 'ipc')

  // 在系统浏览器里打开当前预览地址。只放行本机地址，避免这条通道被当成
  // 任意 URL 的 openExternal。
  safeIpcHandle('preview:openExternal', async (_event, url: string) => {
    if (typeof url !== 'string' || !isLocalPreviewUrl(url)) {
      logger.security.warn('[Preview] Blocked non-local external open', { url })
      return false
    }
    return openExternalSafely(url)
  }, 'ipc')

  logger.ipc.info('[Preview] Preview handlers registered')
}
