/** Use the application's fetch (Chromium + configured proxy after startup). */
export async function catalogJson<T>(url: string): Promise<T> {
  const endpoint = new URL(url).hostname
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) {
      const limited = response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0'
      throw new Error(`HTTP ${response.status}${limited ? ' (rate limit reached; retry later)' : ''}`)
    }
    return await response.json() as T
  } catch (error) {
    const reason = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
      ? 'request timed out after 30 seconds'
      : error instanceof Error ? error.message : 'network request failed'
    throw new Error(`${endpoint}: ${reason}. Check Network / proxy settings and retry. Catalog failure does not mean no packages are available.`)
  }
}
