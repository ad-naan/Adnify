import { afterEach, describe, expect, it, vi } from 'vitest'
import { CNB_RELEASES_URL, cnbReleaseFeed, fetchLatestCnbRelease } from './cnbRelease'

afterEach(() => vi.unstubAllGlobals())

describe('CNB release source', () => {
  it('resolves the published tag anonymously and pins downloads to it', async () => {
    const release = { tag_name: 'v1.7.72', draft: false, prerelease: false, assets: [] }
    const fetcher = vi.fn().mockResolvedValue(Response.json(release))
    vi.stubGlobal('fetch', fetcher)

    expect(await fetchLatestCnbRelease()).toEqual(release)
    expect(fetcher).toHaveBeenCalledWith(`${CNB_RELEASES_URL}/latest`, {
      headers: { Accept: 'application/vnd.cnb.api+json' },
      signal: expect.any(AbortSignal),
    })
    expect(cnbReleaseFeed(release.tag_name)).toBe(`${CNB_RELEASES_URL}/download/v1.7.72/`)
  })

  it('handles a repository without a latest release', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
    await expect(fetchLatestCnbRelease()).resolves.toBeNull()
  })

  it('rejects drafts, prereleases and non-version tags', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ tag_name: 'v1.7.72', draft: true }))
      .mockResolvedValueOnce(Response.json({ tag_name: 'v1.7.72', prerelease: true }))
      .mockResolvedValueOnce(Response.json({ tag_name: 'nightly' }))
    vi.stubGlobal('fetch', fetcher)

    await expect(fetchLatestCnbRelease()).resolves.toBeNull()
    await expect(fetchLatestCnbRelease()).resolves.toBeNull()
    await expect(fetchLatestCnbRelease()).resolves.toBeNull()
  })

  it('surfaces server failures separately from a missing release', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
    await expect(fetchLatestCnbRelease()).rejects.toThrow('HTTP 503')
  })
})
