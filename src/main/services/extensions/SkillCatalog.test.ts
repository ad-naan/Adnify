import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchSkills } from './SkillCatalog'
import { catalogJson } from './CatalogClient'

afterEach(() => vi.unstubAllGlobals())

describe('configuration catalog discovery', () => {
  it('uses GitHub directly for repository queries and returns installable sources', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ tree: [
      { type: 'blob', path: 'skills/pdf/SKILL.md' },
      { type: 'blob', path: '.claude/skills/review/SKILL.md' },
      { type: 'blob', path: 'README.md' },
      { type: 'blob', path: 'unsupported/deep/nested/SKILL.md' },
    ] })))
    vi.stubGlobal('fetch', fetcher)
    const result = await searchSkills('anthropics/skills')
    expect(fetcher.mock.calls[0][0]).toBe('https://api.github.com/repos/anthropics/skills/git/trees/HEAD?recursive=1')
    expect(result.map(item => item.source)).toEqual(['anthropics/skills@pdf', 'anthropics/skills@review'])
    await searchSkills('anthropics/skills')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('reports timeout endpoint and guidance instead of an empty catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError') }))
    await expect(searchSkills('timeout-test')).rejects.toThrow('skills.sh: request timed out after 30 seconds')
  })

  it('reports HTTP failure and does not cache it as no matches', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ skills: [{ source: 'owner/repo', skillId: 'test', name: 'Test' }] })))
    vi.stubGlobal('fetch', fetcher)
    await expect(searchSkills('retry-test')).rejects.toThrow('HTTP 503')
    expect(await searchSkills('retry-test')).toHaveLength(1)
  })

  it('uses a bounded abort signal for MCP catalogs as well', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return new Response('{}')
    })
    vi.stubGlobal('fetch', fetcher)
    await catalogJson('https://registry.modelcontextprotocol.io/v0.1/servers')
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
