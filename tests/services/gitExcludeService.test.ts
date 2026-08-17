import { beforeEach, describe, expect, it, vi } from 'vitest'

const fileApi = {
  exists: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
}

vi.mock('@renderer/services/electronAPI', () => ({ api: { file: fileApi } }))
vi.mock('@renderer/services/gitService', () => ({
  gitService: {
    discoverRepositories: vi.fn(),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

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

  it('reports whether the exact root-anchored pattern is present', async () => {
    const { gitExcludeService } = await import('@renderer/services/gitExcludeService')
    const { gitService } = await import('@renderer/services/gitService')
    vi.mocked(gitService.discoverRepositories).mockResolvedValue([
      { root: 'E:/repo', name: 'repo', relativePath: '', isWorkspaceRoot: false },
    ])
    const existsCalls: string[] = []
    const readCalls: string[] = []
    vi.mocked(fileApi.exists).mockImplementation(async path => {
      existsCalls.push(path)
      return path === 'E:/repo/.gitignore'
    })
    vi.mocked(fileApi.read).mockImplementation(async path => {
      readCalls.push(path)
      return '/logs/\n/.agent/cache/\n'
    })

    const ignored = await gitExcludeService.getStatus('E:/workspace', 'E:/repo/.agent/cache', true)
    expect(ignored).toEqual({ pattern: '/.agent/cache/', ignored: true, available: true })

    vi.mocked(fileApi.read).mockResolvedValue('/logs/\n')
    const notIgnored = await gitExcludeService.getStatus('E:/workspace', 'E:/repo/.agent/cache', true)
    expect(notIgnored).toEqual({ pattern: '/.agent/cache/', ignored: false, available: true })
    expect(existsCalls).toEqual(['E:/repo/.gitignore', 'E:/repo/.gitignore'])
    expect(readCalls).toEqual(['E:/repo/.gitignore'])
  })

  it('marks paths outside Git repositories unavailable and creates the root .gitignore when adding', async () => {
    const { gitExcludeService } = await import('@renderer/services/gitExcludeService')
    const { gitService } = await import('@renderer/services/gitService')
    vi.mocked(gitService.discoverRepositories)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { root: 'E:/repo', name: 'repo', relativePath: '', isWorkspaceRoot: false },
      ])

    await expect(gitExcludeService.getStatus('E:/workspace', 'E:/workspace/plain/file.txt', false))
      .resolves.toEqual({ pattern: '', ignored: false, available: false })

    vi.mocked(fileApi.exists).mockResolvedValue(false)
    vi.mocked(fileApi.write).mockResolvedValue(true)
    await expect(gitExcludeService.update('E:/workspace', 'E:/repo/logs', true, 'add'))
      .resolves.toEqual({ changed: true, pattern: '/logs/' })
    expect(fileApi.write).toHaveBeenCalledWith('E:/repo/.gitignore', '/logs/\n')
  })

  it('treats a Git repository without .gitignore as available but not ignored', async () => {
    const { gitExcludeService } = await import('@renderer/services/gitExcludeService')
    const { gitService } = await import('@renderer/services/gitService')
    vi.mocked(gitService.discoverRepositories).mockResolvedValue([
      { root: 'E:/repo', name: 'repo', relativePath: '', isWorkspaceRoot: false },
    ])
    vi.mocked(fileApi.exists).mockResolvedValue(false)

    await expect(gitExcludeService.getStatus('E:/workspace', 'E:/repo/logs', true))
      .resolves.toEqual({ pattern: '/logs/', ignored: false, available: true })
    expect(fileApi.read).not.toHaveBeenCalled()
  })
})
