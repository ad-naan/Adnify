import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { resolveGitMetadataDirectory } from '@main/services/gitMetadata'

const roots: string[] = []

afterEach(() => {
  roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }))
})

describe('resolveGitMetadataDirectory', () => {
  it('finds a repository marker from a nested workspace folder', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adnify-git-meta-'))
    roots.push(root)
    fs.mkdirSync(path.join(root, '.git'))
    const nested = path.join(root, 'packages', 'app')
    fs.mkdirSync(nested, { recursive: true })

    await expect(resolveGitMetadataDirectory(nested)).resolves.toBe(path.join(root, '.git'))
  })

  it('resolves a linked-worktree gitdir file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adnify-git-meta-'))
    roots.push(root)
    const metadata = path.join(root, 'main', '.git', 'worktrees', 'feature')
    const worktree = path.join(root, 'feature')
    fs.mkdirSync(metadata, { recursive: true })
    fs.mkdirSync(worktree, { recursive: true })
    fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${metadata}\n`)

    await expect(resolveGitMetadataDirectory(worktree)).resolves.toBe(metadata)
  })
})
