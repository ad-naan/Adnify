/**
 * HTTP 服务 IPC handlers
 * 提供网络请求能力给渲染进程
 */

import { logger } from '@shared/utils/Logger'
import { safeIpcHandle } from './safeHandle'
import { htmlToText } from '../services/markupText'

// ===== 读取 URL 内容 =====

interface ReadUrlResult {
    success: boolean
    content?: string
    title?: string
    error?: string
    contentType?: string
    statusCode?: number
}

function parseHttpUrl(url: string): URL | null {
    try {
        const parsed = new URL(url)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null
    } catch {
        return null
    }
}

/**
 * 使用 Jina Reader API 读取 URL 内容
 * Jina Reader 专为 LLM 优化，支持 JS 渲染页面
 * 免费无限制使用
 */
async function fetchWithJinaReader(url: string, timeout = 60000): Promise<ReadUrlResult> {
    try {
        const controller = new AbortController()
        const id = setTimeout(() => controller.abort(), timeout)

        const response = await fetch(`https://r.jina.ai/${url}`, {
            headers: {
                'Accept': 'text/plain',
                'User-Agent': 'Adnify/1.0 (AI Code Editor)',
            },
            signal: controller.signal,
        })
        clearTimeout(id)

        if (!response.ok) {
            return {
                success: false,
                error: `Jina Reader returned status ${response.status}`,
                statusCode: response.status,
            }
        }

        const data = await response.text()

        // 限制响应大小
        let content = data
        if (data.length > 500000) {
            content = data.slice(0, 500000) + '\n\n...(truncated, content too large)'
        }

        let title = ''
        const titleMatch = content.match(/^#\s+(.+)$/m)
        if (titleMatch) {
            title = titleMatch[1].trim()
        }

        return {
            success: true,
            content,
            title,
            statusCode: response.status,
            contentType: 'text/markdown',
        }
    } catch (error: any) {
        return {
            success: false,
            error: `Jina Reader request failed: ${error.message || error}`,
        }
    }
}

async function fetchUrlDirect(url: string, timeout = 60000): Promise<ReadUrlResult> {
    try {
        const controller = new AbortController()
        const id = setTimeout(() => controller.abort(), timeout)

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
                'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
            },
            signal: controller.signal,
        })
        clearTimeout(id)

        const contentType = response.headers.get('content-type') || ''
        if (!contentType.includes('text') &&
            !contentType.includes('json') &&
            !contentType.includes('xml') &&
            !contentType.includes('javascript')) {
            return {
                success: false,
                error: `Unsupported content type: ${contentType}`,
                statusCode: response.status,
                contentType,
            }
        }

        const data = await response.text()
        let content = data
        if (data.length > 500000) {
            content = data.slice(0, 500000) + '\n\n...(truncated, content too large)'
        }

        let title = ''
        const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i)
        if (titleMatch) {
            title = titleMatch[1].trim()
        }

        if (contentType.includes('html')) {
            content = htmlToText(content)
        }

        return {
            success: true,
            content,
            title,
            statusCode: response.status,
            contentType,
        }
    } catch (error: any) {
        return {
            success: false,
            error: `Request failed: ${error.message || error}`,
        }
    }
}

/**
 * 读取 URL 内容
 * 优先使用 Jina Reader，失败时回退到直接抓取
 */
async function fetchUrl(url: string, timeout = 60000): Promise<ReadUrlResult> {
    const parsedUrl = parseHttpUrl(url)

    // 对于非 HTTP(S) URL，直接返回错误
    if (!parsedUrl) {
        return {
            success: false,
            error: 'Only HTTP and HTTPS URLs are supported',
        }
    }

    // 对于 JSON/API 端点，直接抓取更合适。主机名必须精确匹配，避免子域伪装。
    const hostname = parsedUrl.hostname.toLowerCase()
    const pathname = parsedUrl.pathname.toLowerCase()
    const isApiEndpoint = pathname.includes('/api/') ||
        pathname.endsWith('.json') ||
        hostname === 'raw.githubusercontent.com' ||
        hostname === 'api.github.com'

    if (isApiEndpoint) {
        logger.ipc.debug('[HTTP] API endpoint detected, using direct fetch')
        return fetchUrlDirect(url, timeout)
    }

    // 优先使用 Jina Reader
    logger.ipc.debug('[HTTP] Trying Jina Reader for:', url)
    const jinaResult = await fetchWithJinaReader(url, timeout)

    if (jinaResult.success) {
        logger.ipc.debug('[HTTP] Jina Reader succeeded')
        return jinaResult
    }

    // Jina 失败，回退到直接抓取
    logger.ipc.warn('[HTTP] Jina Reader failed, falling back to direct fetch:', jinaResult.error)
    return fetchUrlDirect(url, timeout)
}

function decodeHtmlEntities(text: string): string {
    const namedEntities: Record<string, string> = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' ',
    }

    return text.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (entity, body: string) => {
        if (body[0] === '#') {
            const isHex = body[1]?.toLowerCase() === 'x'
            const codePoint = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10)
            return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
                ? String.fromCodePoint(codePoint)
                : entity
        }
        return namedEntities[body.toLowerCase()] ?? entity
    })
}

// ===== 网络搜索 =====
// 优先级：Google PSE → DuckDuckGo

interface SearchResult {
    title: string
    url: string
    snippet: string
}

interface WebSearchResult {
    success: boolean
    results?: SearchResult[]
    error?: string
}

// 搜索 API 配置缓存
let cachedGoogleApiKey: string | null = null
let cachedGoogleCx: string | null = null

// 设置 Google PSE API 配置
export function setGoogleSearchConfig(apiKey: string, cx: string) {
    cachedGoogleApiKey = apiKey
    cachedGoogleCx = cx
    logger.ipc.info('[HTTP] Google PSE configured')
}

async function webSearch(query: string, maxResults = 5, timeout?: number): Promise<WebSearchResult> {
    // 优先使用 Google PSE（如果配置了）
    const googleApiKey = cachedGoogleApiKey || process.env.GOOGLE_API_KEY || ''
    const googleCx = cachedGoogleCx || process.env.GOOGLE_CX || ''

    // 分配超时时间：Google 占 40%，DDG 占 60%（作为回退通常需要更久）
    const totalTimeout = timeout || 30000
    const googleTimeout = Math.floor(totalTimeout * 0.4)
    const ddgTimeout = Math.floor(totalTimeout * 0.6)

    if (googleApiKey && googleCx) {
        try {
            const result = await searchWithGoogle(query, googleApiKey, googleCx, maxResults, googleTimeout)
            if (result.success && result.results && result.results.length > 0) {
                return result
            }
            // 如果是因为报错导致的失败（比如 API key 无效、额度用尽），不再静默回退，直接返回给 AI 让它告诉用户
            if (!result.success && result.error) {
                logger.ipc.error(`[HTTP] Google PSE failed with error: ${result.error}`)
                return {
                    success: false,
                    error: `Google API Error: ${result.error}. Please check your Google API Key and CX in settings.`
                }
            }
            // 只有当成功请求但 0 结果时，才回退
            logger.ipc.warn('[HTTP] Google PSE returned 0 results, falling back to DuckDuckGo')
        } catch (error) {
            logger.ipc.error('[HTTP] Google PSE failed with exception:', error)
            return {
                success: false,
                error: `Google Search API Exception: ${error}. Please check your network or proxy settings.`
            }
        }
    }

    // 回退到 DuckDuckGo
    try {
        return await searchWithDuckDuckGo(query, maxResults, ddgTimeout)
    } catch (error) {
        logger.ipc.error('[HTTP] DuckDuckGo search failed:', error)
        return {
            success: false,
            error: `搜索失败: ${error}`,
        }
    }
}

// Google Programmable Search Engine API
async function searchWithGoogle(query: string, apiKey: string, cx: string, maxResults: number, timeout = 15000): Promise<WebSearchResult> {
    try {
        const encodedQuery = encodeURIComponent(query)
        const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodedQuery}&num=${Math.min(maxResults, 10)}`

        const controller = new AbortController()
        const id = setTimeout(() => controller.abort(), timeout)

        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json',
            },
            signal: controller.signal,
        })
        clearTimeout(id)

        const json = await response.json() as any
        if (json.error) {
            return {
                success: false,
                error: `Google API error: ${json.error.message || json.error.code}`
            }
        }

        const results: SearchResult[] = []
        if (json.items) {
            for (const item of json.items.slice(0, maxResults)) {
                results.push({
                    title: item.title || '',
                    url: item.link || '',
                    snippet: item.snippet || '',
                })
            }
        }

        return { success: true, results }
    } catch (error: any) {
        return { success: false, error: `Google request failed: ${error.message || error}` }
    }
}

async function searchWithDuckDuckGo(query: string, maxResults: number, timeout = 25000): Promise<WebSearchResult> {
    try {
        const encodedQuery = encodeURIComponent(query)
        const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`

        const controller = new AbortController()
        const id = setTimeout(() => controller.abort(), timeout)

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            signal: controller.signal,
        })
        clearTimeout(id)

        const data = await response.text()
        const results = parseDuckDuckGoHtml(data, maxResults)
        return { success: true, results }
    } catch (error: any) {
        return { success: false, error: `DuckDuckGo request failed: ${error.message || error}` }
    }
}

// 解析 DuckDuckGo HTML 响应
function parseDuckDuckGoHtml(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = []

    // DuckDuckGo HTML 版本的结果在 class="result" 的 div 中
    // 标题在 class="result__a" 的 a 标签中
    // 摘要在 class="result__snippet" 的 a 标签中

    // 匹配结果块
    const resultRegex = /<div[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([^<]*)<\/a>/gi

    let match
    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
        let url = match[1]
        const title = decodeHtmlEntities(match[2].trim())
        const snippet = decodeHtmlEntities(match[3].trim())

        // DuckDuckGo 的链接是重定向链接，需要提取真实 URL
        if (url.includes('uddg=')) {
            const uddgMatch = url.match(/uddg=([^&]+)/)
            if (uddgMatch) {
                url = decodeURIComponent(uddgMatch[1])
            }
        }

        if (title && url) {
            results.push({ title, url, snippet })
        }
    }

    // 如果上面的正则没匹配到，尝试更宽松的匹配
    if (results.length === 0) {
        const linkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>/gi
        const snippetRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([^<]+)<\/a>/gi

        const links: { url: string; title: string }[] = []
        const snippets: string[] = []

        while ((match = linkRegex.exec(html)) !== null) {
            let url = match[1]
            if (url.includes('uddg=')) {
                const uddgMatch = url.match(/uddg=([^&]+)/)
                if (uddgMatch) url = decodeURIComponent(uddgMatch[1])
            }
            links.push({ url, title: decodeHtmlEntities(match[2].trim()) })
        }

        while ((match = snippetRegex.exec(html)) !== null) {
            snippets.push(decodeHtmlEntities(match[1].trim()))
        }

        for (let i = 0; i < Math.min(links.length, maxResults); i++) {
            results.push({
                title: links[i].title,
                url: links[i].url,
                snippet: snippets[i] || '',
            })
        }
    }

    return results
}

// ===== 注册 IPC Handlers =====

export function registerHttpHandlers() {
    // 读取 URL 内容
    safeIpcHandle('http:readUrl', async (_event, url: string, timeout?: number) => {
        logger.ipc.info('[HTTP] Reading URL:', url)
        return fetchUrl(url, timeout)
    })

    // 网络搜索
    safeIpcHandle('http:webSearch', async (_event, query: string, maxResults?: number, timeout?: number) => {
        logger.ipc.info('[HTTP] Web search:', query, 'timeout:', timeout)
        return webSearch(query, maxResults, timeout)
    })

    // 配置 Google PSE
    safeIpcHandle('http:setGoogleSearch', async (_event, apiKey: string, cx: string) => {
        setGoogleSearchConfig(apiKey, cx)
        return { success: true }
    })

    logger.ipc.info('[HTTP] IPC handlers registered')
}
