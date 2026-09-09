import { describe, expect, it } from 'vitest'
import { parseSkillSource } from './SkillSource'

describe('parseSkillSource', () => {
  it('accepts a skills.sh package reference', () => {
    expect(parseSkillSource('owner/repository@review-code')).toEqual({
      repositoryUrl: 'https://github.com/owner/repository.git',
      skillId: 'review-code',
    })
  })

  it('accepts a direct GitHub repository URL and derives the Skill ID', () => {
    expect(parseSkillSource('https://github.com/Owner/review_skill.git')).toEqual({
      repositoryUrl: 'https://github.com/Owner/review_skill.git',
      skillId: 'review-skill',
    })
  })

  it.each([
    'http://github.com/owner/repository',
    'https://github.example.com/owner/repository',
    'https://user:secret@github.com/owner/repository',
    'https://github.com/owner/repository/tree/main/skill',
  ])('rejects an unsafe or ambiguous GitHub source: %s', source => {
    expect(() => parseSkillSource(source)).toThrow()
  })
})
