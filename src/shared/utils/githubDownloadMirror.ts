/**
 * GitHub release download mirrors (mainly for mainland China networks).
 * Prefix form: https://<mirror>/<original-https-url>
 */

export const GITHUB_DOWNLOAD_MIRRORS = [
  'https://ghfast.top/',
  'https://gh-proxy.com/',
  'https://mirror.ghproxy.com/',
] as const

const GITHUB_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
])

export function isGithubDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return GITHUB_HOSTS.has(parsed.hostname) || parsed.hostname.endsWith('.githubusercontent.com')
  } catch {
    return false
  }
}

export function normalizeMirrorPrefix(mirror: string): string {
  const trimmed = mirror.trim()
  if (!trimmed) return ''
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

/** Build a proxied URL; no-op for non-GitHub URLs or empty mirrors. */
export function applyGithubDownloadMirror(url: string, mirrorPrefix: string): string {
  if (!url || !mirrorPrefix || !isGithubDownloadUrl(url)) return url
  if (url.startsWith(mirrorPrefix)) return url
  return `${normalizeMirrorPrefix(mirrorPrefix)}${url}`
}

/**
 * Generic electron-updater feed that points at GitHub "latest/download"
 * through a mirror, so channel yml + assets both go via the proxy.
 */
export function buildMirroredGithubLatestFeedUrl(
  owner: string,
  repo: string,
  mirrorPrefix: string,
): string {
  const direct = `https://github.com/${owner}/${repo}/releases/latest/download`
  return applyGithubDownloadMirror(direct, mirrorPrefix)
}

export type UpdateDownloadSource = 'github' | 'mirror'

export function resolveUpdateDownloadSource(options: {
  locale?: string
  envForce?: string | undefined
}): UpdateDownloadSource {
  const force = (options.envForce || '').trim().toLowerCase()
  if (force === '0' || force === 'false' || force === 'github' || force === 'direct') {
    return 'github'
  }
  if (force === '1' || force === 'true' || force === 'mirror') {
    return 'mirror'
  }
  const locale = (options.locale || '').toLowerCase()
  return locale.startsWith('zh') ? 'mirror' : 'github'
}
