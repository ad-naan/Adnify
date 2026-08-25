import { promises as fsPromises } from 'fs'
import * as path from 'path'

export async function resolveGitMetadataDirectory(workspaceRoot: string): Promise<string | null> {
  let current = path.resolve(workspaceRoot)
  while (true) {
    const markerPath = path.join(current, '.git')
    try {
      const stat = await fsPromises.stat(markerPath)
      if (stat.isDirectory()) return markerPath
      if (stat.isFile()) {
        const marker = await fsPromises.readFile(markerPath, 'utf-8')
        const match = /^gitdir:\s*(.+)$/im.exec(marker)
        if (match?.[1]) return path.resolve(current, match[1].trim())
      }
    } catch {
      // Not a repository root; continue with the parent directory.
    }

    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}
