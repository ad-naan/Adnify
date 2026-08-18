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

  it('reports whether the exact root-anchored pattern is present in .gitignore and .git/info/exclude', async () => {
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
      return path === 'E:/repo/.gitignore' ? '/logs/\n/.agent/cache/\n' : ''
    })

    const status = await gitExcludeService.getStatus('E:/workspace', 'E:/repo/.agent/cache', true)
    expect(status).toEqual({
      available: true,
      gitignore: { pattern: '/.agent/cache/', ignored: true, available: true },
      exclude: { pattern: '/.agent/cache/', ignored: false, available: true },
    })

    vi.mocked(fileApi.read).mockImplementation(async path => {
      readCalls.push(path)
      return path === 'E:/repo/.gitignore' ? '/logs/\n' : ''
    })
    const notIgnored = await gitExcludeService.getStatus('E:/workspace', 'E:/repo/.agent/cache', true)
    expect(notIgnored).toEqual({
      available: true,
      gitignore: { pattern: '/.agent/cache/', ignored: false, available: true },
      exclude: { pattern: '/.agent/cache/', ignored: false, available: true },
    })
    expect(existsCalls).toEqual([
      'E:/repo/.gitignore',
      'E:/repo/.git/info/exclude',
      'E:/repo/.gitignore',
      'E:/repo/.git/info/exclude',
    ])
  })

  it('marks paths outside Git repositories unavailable and supports target selection when adding', async () => {
    const { gitExcludeService } = await import('@renderer/services/gitExcludeService')
    const { gitService } = await import('@renderer/services/gitService')
    vi.mocked(gitService.discoverRepositories)
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { root: 'E:/repo', name: 'repo', relativePath: '', isWorkspaceRoot: false },
      ])

    await expect(gitExcludeService.getStatus('E:/workspace', 'E:/workspace/plain/file.txt', false))
      .resolves.toEqual({
        available: false,
        gitignore: { pattern: '', ignored: false, available: false },
        exclude: { pattern: '', ignored: false, available: false },
      })

    vi.mocked(fileApi.exists).mockResolvedValue(false)
    vi.mocked(fileApi.write).mockResolvedValue(true)

    // 添加到 .gitignore
    await expect(gitExcludeService.update('E:/workspace', 'E:/repo/logs', true, 'add', 'gitignore'))
      .resolves.toEqual({ changed: true, pattern: '/logs/', target: 'gitignore' })
    expect(fileApi.write).toHaveBeenCalledWith('E:/repo/.gitignore', '/logs/\n')

    // 添加到 .git/info/exclude (默认目标)
    await expect(gitExcludeService.update('E:/workspace', 'E:/repo/logs', true, 'add', 'exclude'))
      .resolves.toEqual({ changed: true, pattern: '/logs/', target: 'exclude' })
    expect(fileApi.write).toHaveBeenCalledWith('E:/repo/.git/info/exclude', '/logs/\n')
  })

  it('treats a Git repository without ignore files as available but not ignored', async () => {
    const { gitExcludeService } = await import('@renderer/services/gitExcludeService')
    const { gitService } = await import('@renderer/services/gitService')
    vi.mocked(gitService.discoverRepositories).mockResolvedValue([
      { root: 'E:/repo', name: 'repo', relativePath: '', isWorkspaceRoot: false },
    ])
    vi.mocked(fileApi.exists).mockResolvedValue(false)

    await expect(gitExcludeService.getStatus('E:/workspace', 'E:/repo/logs', true))
      .resolves.toEqual({
        available: true,
        gitignore: { pattern: '/logs/', ignored: false, available: true },
        exclude: { pattern: '/logs/', ignored: false, available: true },
      })
    expect(fileApi.read).not.toHaveBeenCalled()
  })
})
