import { api } from './electronAPI'
import { gitService } from './gitService'
import { getDirPath, normalizePath, toRelativePath } from '@shared/utils/pathUtils'

export function createGitExcludePattern(repoRoot: string, targetPath: string, isDirectory: boolean): string {
  const relative = toRelativePath(normalizePath(targetPath), normalizePath(repoRoot))
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
  const escaped = relative.replace(/([\\[\]*?!# ])/g, '\\$1')
  return `/${escaped}${isDirectory ? '/' : ''}`
}

export function updateGitExcludeContent(content: string, pattern: string, action: 'add' | 'remove'): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const hasPattern = lines.some(line => line.trim() === pattern)
  if (action === 'add' && hasPattern) return content

  if (action === 'remove') {
    if (!hasPattern) return content
    const hadTrailingNewline = /\r?\n$/.test(content)
    const filtered = lines.filter(line => line.trim() !== pattern)
    while (filtered.length > 0 && filtered.at(-1) === '') filtered.pop()
    return filtered.join(newline) + (hadTrailingNewline && filtered.length > 0 ? newline : '')
  }

  while (lines.length > 0 && lines.at(-1) === '') lines.pop()
  lines.push(pattern, '')
  return lines.join(newline)
}

class GitExcludeService {
  async update(
    workspacePath: string,
    targetPath: string,
    isDirectory: boolean,
    action: 'add' | 'remove',
  ): Promise<{ changed: boolean; pattern: string }> {
    const normalizedTarget = normalizePath(targetPath).replace(/\/$/, '')
    const repositories = await gitService.discoverRepositories(workspacePath, 3)
    const repository = repositories
      .filter(repo => normalizedTarget === repo.root || normalizedTarget.startsWith(`${repo.root}/`))
      .sort((left, right) => right.root.length - left.root.length)[0]
    if (!repository) throw new Error('所选内容不在 Git 仓库中')

    const pattern = createGitExcludePattern(repository.root, targetPath, isDirectory)
    const excludePath = await gitService.getExcludeFilePath(repository.root)
    const exists = await api.file.exists(excludePath)
    const current = exists ? (await api.file.read(excludePath) || '') : ''
    const next = updateGitExcludeContent(current, pattern, action)
    if (next === current) return { changed: false, pattern }

    await api.file.ensureDir(getDirPath(excludePath))
    const written = await api.file.write(excludePath, next)
    if (!written) throw new Error('写入 .git/info/exclude 失败')
    return { changed: true, pattern }
  }
}

export const gitExcludeService = new GitExcludeService()
