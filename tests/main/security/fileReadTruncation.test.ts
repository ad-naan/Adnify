import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readFileSized, readLargeFile } from '@main/security/fileUtils'

/**
 * Regression cover for the silent-truncation data loss.
 *
 * A read that quietly returned only the first bytes of a large file was
 * indistinguishable from a short file downstream, so callers that parsed the
 * result saw an almost-empty document, and callers that wrote it back truncated
 * the file on disk.
 */

let tempDir: string

beforeAll(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adnify-read-'))
})

afterAll(async () => {
  await fs.rm(tempDir, { recursive: true, force: true })
})

async function writeJsonlFixture(name: string, lineCount: number): Promise<string> {
  const filePath = path.join(tempDir, name)
  const line = JSON.stringify({
    id: 'x'.repeat(120),
    role: 'assistant',
    content: 'y'.repeat(2200),
  })
  await fs.writeFile(filePath, Array.from({ length: lineCount }, () => line).join('\n'))
  return filePath
}

function countParsableLines(content: string): number {
  return content
    .split(/\r?\n/)
    .filter(line => line.trim())
    .filter(line => {
      try {
        JSON.parse(line)
        return true
      } catch {
        return false
      }
    }).length
}

describe('readFileSized', () => {
  it('returns every line of a JSONL file larger than the preview limit', async () => {
    const filePath = await writeJsonlFixture('session.jsonl', 3000)
    const { size } = await readFileSized(filePath, undefined, Number.POSITIVE_INFINITY)
    expect(size).toBeGreaterThan(5 * 1024 * 1024)

    const result = await readFileSized(filePath, undefined, Number.POSITIVE_INFINITY)

    expect(result.truncated).toBe(false)
    expect(countParsableLines(result.content ?? '')).toBe(3000)
  })

  it('flags a preview read so callers can tell it apart from a short file', async () => {
    const filePath = await writeJsonlFixture('preview.jsonl', 3000)

    const result = await readFileSized(filePath, undefined, 5 * 1024 * 1024)

    expect(result.truncated).toBe(true)
    // The reported size is the real file size, not the length of what was read.
    expect(result.size).toBeGreaterThan(result.content!.length)
  })

  it('does not flag a file that fits inside the preview limit', async () => {
    const filePath = path.join(tempDir, 'small.txt')
    await fs.writeFile(filePath, 'hello world')

    const result = await readFileSized(filePath, undefined, 5 * 1024 * 1024)

    expect(result).toMatchObject({ content: 'hello world', truncated: false })
  })

  it('round-trips content unchanged so a read-modify-write cannot shrink the file', async () => {
    const filePath = path.join(tempDir, 'source.js')
    const original = 'const x = 1; // padding\n'.repeat(400_000)
    await fs.writeFile(filePath, original)
    expect((await fs.stat(filePath)).size).toBeGreaterThan(5 * 1024 * 1024)

    const result = await readFileSized(filePath, undefined, Number.POSITIVE_INFINITY)
    await fs.writeFile(filePath, result.content!)

    expect((await fs.stat(filePath)).size).toBe(Buffer.byteLength(original))
  })
})

describe('readLargeFile', () => {
  it('reads a byte range rather than a line range', async () => {
    const filePath = path.join(tempDir, 'bytes.txt')
    await fs.writeFile(filePath, 'abcdefghij')

    await expect(readLargeFile(filePath, 0, 4)).resolves.toBe('abcd')
    await expect(readLargeFile(filePath, 4, 3)).resolves.toBe('efg')
  })

  it('returns null for a missing file instead of throwing', async () => {
    await expect(readLargeFile(path.join(tempDir, 'nope.txt'), 0, 16)).resolves.toBeNull()
  })
})
