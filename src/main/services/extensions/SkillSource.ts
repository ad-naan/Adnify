export interface ParsedSkillSource {
  repositoryUrl: string
  skillId: string
}

const REPOSITORY_PART = /^[a-zA-Z0-9_.-]+$/
const SKILL_ID = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

export function parseSkillSource(source: string): ParsedSkillSource {
  const value = source.trim()
  const marketplace = /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/.exec(value)
  if (marketplace) {
    return {
      repositoryUrl: `https://github.com/${marketplace[1]}/${marketplace[2]}.git`,
      skillId: marketplace[3],
    }
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Skill source must be owner/repository@skill-id or a GitHub repository URL')
  }

  const parts = url.pathname.split('/').filter(Boolean)
  const repository = (parts[1] || '').replace(/\.git$/, '')
  const validUrl = url.protocol === 'https:'
    && url.hostname === 'github.com'
    && !url.username
    && !url.password
    && !url.port
    && !url.search
    && !url.hash
    && parts.length === 2
    && REPOSITORY_PART.test(parts[0] || '')
    && REPOSITORY_PART.test(repository)
  if (!validUrl) throw new Error('Only a direct https://github.com/owner/repository URL is supported')

  const skillId = repository.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!SKILL_ID.test(skillId)) throw new Error('The GitHub repository name cannot be converted to a valid Skill ID')
  return { repositoryUrl: `https://github.com/${parts[0]}/${repository}.git`, skillId }
}
