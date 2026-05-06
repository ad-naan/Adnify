import Store from 'electron-store'
import { logger } from '@shared/utils/Logger'
import { toAppError } from '@shared/utils/errorHandler'

const configStore = new Store<Record<string, unknown>>({ name: 'config' })
const APP_SETTINGS_KEY = 'app-settings'
const DEFAULT_ACCEPT = 'application/vnd.github+json'
const DEFAULT_USER_AGENT = 'Adnify-GitHub-Service'
const DEFAULT_API_VERSION = '2022-11-28'

export interface GitHubReleaseAsset {
  name: string
  browser_download_url: string
}

export interface GitHubRelease {
  tag_name?: string
  body?: string
  published_at?: string
  assets?: GitHubReleaseAsset[]
}

function getGitHubToken(): string | undefined {
  const appSettings = configStore.get(APP_SETTINGS_KEY) as Record<string, unknown> | undefined
  const token = appSettings?.githubToken
  return typeof token === 'string' && token.trim() ? token.trim() : undefined
}

function buildHeaders(userAgent = DEFAULT_USER_AGENT, accept = DEFAULT_ACCEPT): Record<string, string> {
  const token = getGitHubToken()
  return {
    Accept: accept,
    'User-Agent': userAgent,
    'X-GitHub-Api-Version': DEFAULT_API_VERSION,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export async function fetchGitHubJson<T>(
  url: string,
  options: {
    userAgent?: string
    accept?: string
    signal?: AbortSignal
  } = {},
): Promise<T> {
  const hasToken = Boolean(getGitHubToken())
  logger.system.info('[GitHub API] Sending request', {
    url,
    userAgent: options.userAgent || DEFAULT_USER_AGENT,
    accept: options.accept || DEFAULT_ACCEPT,
    apiVersion: DEFAULT_API_VERSION,
    hasToken,
  })

  const response = await fetch(url, {
    headers: buildHeaders(options.userAgent, options.accept),
    signal: options.signal,
  })

  const remaining = response.headers.get('X-RateLimit-Remaining')
  const resetTime = response.headers.get('X-RateLimit-Reset')
  const limit = response.headers.get('X-RateLimit-Limit')
  const resource = response.headers.get('X-RateLimit-Resource')

  logger.system.info('[GitHub API] Response received', {
    url,
    status: response.status,
    statusText: response.statusText,
    hasToken,
    limit,
    remaining,
    resetTime,
    resource,
  })

  if (!response.ok) {
    if (response.status === 403) {
      const guidance = hasToken
        ? 'GitHub API request was rate limited or forbidden even with the configured token.'
        : 'GitHub API request was rate limited. Configure a GitHub token in Settings > System to raise the limit.'
      logger.system.error('[GitHub API] Request forbidden', {
        url,
        hasToken,
        limit,
        remaining,
        resetTime,
        resource,
      })
      throw new Error(`${guidance} HTTP 403`)
    }

    const detail = `GitHub API error: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
    logger.system.warn('[GitHub API] Request failed', {
      url,
      status: response.status,
      statusText: response.statusText,
      remaining,
      resetTime,
      hasToken,
    })
    throw new Error(detail)
  }

  return await response.json() as T
}

export async function fetchLatestRelease(
  owner: string,
  repo: string,
  options: {
    userAgent?: string
    signal?: AbortSignal
  } = {},
): Promise<GitHubRelease> {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`
  try {
    logger.system.info('[GitHub API] Fetching latest release', {
      owner,
      repo,
      url,
      hasToken: Boolean(getGitHubToken()),
    })
    return await fetchGitHubJson<GitHubRelease>(url, options)
  } catch (error) {
    const appError = toAppError(error)
    logger.system.error('[GitHub API] Failed to fetch latest release', {
      owner,
      repo,
      error: appError.message,
    })
    throw error
  }
}
