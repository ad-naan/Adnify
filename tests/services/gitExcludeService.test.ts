import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/services/electronAPI', () => ({ api: {} }))
vi.mock('@renderer/services/gitService', () => ({ gitService: {} }))

describe('git exclude helpers', () => {
  it('creates root-anchored literal patterns', async () => {
    const { createGitExcludePattern } = await import('@renderer/services/gitExcludeService')
    expect(createGitExcludePattern('E:/repo', 'E:/repo/.agent/cache', true)).toBe('/.agent/cache/')
    expect(createGitExcludePattern('E:/repo', 'E:/repo/a file[1].txt', false)).toBe('/a\\ file\\[1\\].txt')
  })

  it('adds idempotently and removes only the exact pattern', async () => {
    const { updateGitExcludeContent } = await import('@renderer/services/gitExcludeService')
    const added = updateGitExcludeContent('# local\n/temp/\n', '/.agent/', 'add')
    expect(added).toBe('# local\n/temp/\n/.agent/\n')
    expect(updateGitExcludeContent(added, '/.agent/', 'add')).toBe(added)
    expect(updateGitExcludeContent(added, '/.agent/', 'remove')).toBe('# local\n/temp/\n')
  })
})
