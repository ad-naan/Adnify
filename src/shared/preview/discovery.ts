/**
 * 本地预览地址的解析与规范化。
 *
 * 放在 shared 里而不是 renderer：主进程要用同一套规则校验探活/外开请求，
 * 渲染进程要用同一套规则从终端输出里认地址。两边分别实现必然会漂移。
 */

/** 可以当作"本机"看待的主机名。0.0.0.0 是监听地址，导航时要换成 127.0.0.1。 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])

const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 }

/** Browser navigation supports ordinary websites; discovery remains local-only. */
export function isBrowserPreviewUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname && !url.username && !url.password
  } catch {
    return false
  }
}

/**
 * 终端输出里的候选地址。`[^\s"'`<>)\]]` 结尾的收窄是为了不把日志里的
 * 引号、括号吃进 URL —— 否则 `(http://localhost:5173/)` 会带着 `)` 进来。
 */
const LOCAL_URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{1,5})?(?:[/?#][^\s"'`<>)\]]*)?/gi

/** 快速预筛。正则在终端 onData 热路径上跑，先用 indexOf 挡掉绝大多数数据块。 */
const LOCAL_HINTS = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]']

export interface LocalPreviewOrigin {
  /** 用于导航的规范 origin，例如 http://127.0.0.1:5173 */
  origin: string
  protocol: 'http:' | 'https:'
  /** 原始主机名，保留用于展示（用户看到的是自己终端里打印的那个） */
  host: string
  port: number
  /**
   * 稳定身份：protocol + port。
   *
   * 关键设计——localhost:5173 和 127.0.0.1:5173 折叠成同一个候选，
   * 且 origin 之后的路径全部丢弃。Vite / Next 的 HMR 与静态资源日志会刷出
   * 几十条同端口不同路径的 URL，按完整 URL 做身份会把它们当成几十个"新发现的服务"。
   */
  key: string
}

/**
 * 导航用主机名。
 *
 * localhost / 0.0.0.0 都收敛到 127.0.0.1，让同一端口只有一个规范 origin
 * （key 已经把它们折叠成一个候选，origin 不统一就会出现"同一个候选、两个地址"）。
 *
 * 代价：dev server 只监听 ::1 时，127.0.0.1 连不上。这种情况由探活侧兜住 ——
 * 主进程探活失败后会用 localhost 再试一次，并把真正能连上的地址报回来。
 */
function normalizeHostForNavigation(host: string): string {
  if (host === '0.0.0.0' || host === 'localhost') return '127.0.0.1'
  if (host === '::1') return '[::1]'
  return host
}

/**
 * 把任意本地 URL 收敡成 origin 级候选。非本地地址、非 http(s) 一律返回 null。
 */
export function parseLocalPreviewOrigin(value: string): LocalPreviewOrigin | null {
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null
  }

  const rawHost = parsed.hostname.toLowerCase()
  const bracketedHost = parsed.host.toLowerCase().startsWith('[') ? '[::1]' : rawHost
  const host = rawHost === '::1' ? '[::1]' : bracketedHost

  if (!LOCAL_HOSTS.has(rawHost) && !LOCAL_HOSTS.has(host)) {
    return null
  }

  const port = parsed.port ? Number(parsed.port) : DEFAULT_PORTS[parsed.protocol]
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return null
  }

  const navigationHost = normalizeHostForNavigation(host)
  const protocol = parsed.protocol as 'http:' | 'https:'

  return {
    origin: `${protocol}//${navigationHost}:${port}`,
    protocol,
    host,
    port,
    key: `${protocol}${port}`,
  }
}

/** 主进程用：这个 URL 允许作为本地开发服务探活吗？ */
export function isLocalPreviewUrl(value: string): boolean {
  return parseLocalPreviewOrigin(value) !== null
}

/**
 * 从终端输出里提取本地服务候选，按 key 去重。
 *
 * 返回的是 origin 级候选，同一端口只出现一次，出现顺序即首次出现顺序。
 */
export function extractLocalPreviewOrigins(text: string): LocalPreviewOrigin[] {
  if (!text) return []
  if (!LOCAL_HINTS.some((hint) => text.includes(hint))) return []

  const found = new Map<string, LocalPreviewOrigin>()
  for (const match of text.matchAll(LOCAL_URL_PATTERN)) {
    const origin = parseLocalPreviewOrigin(match[0])
    if (origin && !found.has(origin.key)) {
      found.set(origin.key, origin)
    }
  }

  return [...found.values()]
}

/** 展示用标签。默认端口不显示端口号，和浏览器地址栏一致。 */
export function formatPreviewOriginLabel(origin: LocalPreviewOrigin): string {
  return origin.port === DEFAULT_PORTS[origin.protocol]
    ? origin.host
    : `${origin.host}:${origin.port}`
}

/** 去掉 ANSI 转义序列，终端缓冲区里全是这些。 */
export function stripAnsi(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[()][AB012B]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[=><]/g, '')
}
