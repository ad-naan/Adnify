import * as path from 'path'
import { describe, expect, it } from 'vitest'
import { ChunkerService } from '@main/indexing/chunker'

describe('ChunkerService', () => {
  it('uses platform-independent relative paths in index records', () => {
    const workspacePath = path.join(process.cwd(), 'workspace')
    const filePath = path.join(workspacePath, 'src', 'example.ts')
    const chunks = new ChunkerService().chunkFile(filePath, 'export const value = 1\n', workspacePath)

    expect(chunks).toHaveLength(1)
    expect(chunks[0].relativePath).toBe('src/example.ts')
  })
})
