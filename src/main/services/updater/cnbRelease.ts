export const CNB_RELEASES_URL = 'https://cnb.cool/aadnaan/Adnify/-/releases'

interface CnbRelease {
  tag_name: string
  body?: string
  published_at?: string
  draft?: boolean
  prerelease?: boolean
  assets?: Array<{ name: string }>
}

export async function fetchLatestCnbRelease(): Promise<CnbRelease | null> {
  const response = await fetch(`${CNB_RELEASES_URL}/latest`, {
    headers: { Accept: 'application/vnd.cnb.api+json' },
    signal: AbortSignal.timeout(15_000),
  })

  if (response.status === 404) return null
  if (!response.ok) throw new Error(`CNB release request failed: HTTP ${response.status}`)

  const release = await response.json() as CnbRelease
  if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) return null
  return release
}

export function cnbReleaseFeed(tag: string): string {
  return `${CNB_RELEASES_URL}/download/${encodeURIComponent(tag)}/`
}
