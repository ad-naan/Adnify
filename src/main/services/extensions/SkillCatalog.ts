import type { ExtensionSearchResult } from '@shared/types/extensions'
import { catalogJson } from './CatalogClient'

const cache = new Map<string, { at: number; results: ExtensionSearchResult[] }>()

/** Repository queries go directly to GitHub; they do not depend on skills.sh. */
export async function searchSkills(query: string): Promise<ExtensionSearchResult[]> {
  query = query.trim()
  const cached = cache.get(query)
  if (cached && Date.now() - cached.at < 300_000) return structuredClone(cached.results)
  const repository = /^(?:https:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(query)
  let results: ExtensionSearchResult[]
  if (repository) {
    const source = `${repository[1]}/${repository[2]}`
    const data = await catalogJson<{ tree: Array<{ path: string; type: string }>; truncated?: boolean }>(
      `https://api.github.com/repos/${source}/git/trees/HEAD?recursive=1`,
    )
    if (data.truncated) throw new Error('GitHub repository tree is truncated; use an exact owner/repository@skill-id source.')
    results = data.tree.filter(item => item.type === 'blob' && /^(?:skills\/|\.claude\/skills\/)?[a-z0-9-]+\/SKILL\.md$/.test(item.path))
      .map(item => {
        const name = item.path.split('/').at(-2)!
        return { kind: 'skill' as const, id: `${source}@${name}`, name, source: `${source}@${name}`, description: `Skill in ${source}/${item.path}` }
      })
    if (data.tree.some(item => item.type === 'blob' && item.path === 'SKILL.md')) {
      results.push({ kind: 'skill', id: source, name: repository[2], source: `https://github.com/${source}`, description: `Repository root Skill in ${source}` })
    }
  } else {
    const data = await catalogJson<{ skills?: Array<{ name: string; source: string; installs: number; skillId: string }> }>(
      `https://skills.sh/api/search?q=${encodeURIComponent(query)}`,
    )
    results = (data.skills || []).slice(0, 20).map(skill => ({
      kind: 'skill', id: `${skill.source}@${skill.skillId}`, name: skill.name,
      description: `Skill from ${skill.source}`, source: `${skill.source}@${skill.skillId}`, installs: skill.installs,
    }))
  }
  if (cache.size >= 100) cache.delete(cache.keys().next().value!)
  cache.set(query, { at: Date.now(), results })
  return structuredClone(results)
}
