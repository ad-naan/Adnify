import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readFileSized, readTextFileChunk } from '@main/security/fileUtils'

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

describe('readTextFileChunk', () => {
  it('reconstructs a UTF-8 file exactly from bounded sequential pages', async () => {
    const filePath = path.join(tempDir, 'paged.txt')
    const original = Array.from({ length: 3000 }, (_, index) => `${index}: 性能测试内容-${'x'.repeat(40)}\n`).join('')
    await fs.writeFile(filePath, original)

    let offset = 0
    let reconstructed = ''
    let pageCount = 0
    while (true) {
      const chunk = await readTextFileChunk(filePath, offset, 257)
      reconstructed += chunk.content
      pageCount += 1
      expect(chunk.nextOffset).toBeGreaterThan(offset)
      if (chunk.eof) break
      offset = chunk.nextOffset
    }

    expect(pageCount).toBeGreaterThan(1)
    expect(reconstructed).toBe(original)
  })

  it('does not split UTF-8 characters in a very long line', async () => {
    const filePath = path.join(tempDir, 'unicode-line.txt')
    const original = '界'.repeat(1000)
    await fs.writeFile(filePath, original)

    let offset = 0
    let reconstructed = ''
    while (true) {
      const chunk = await readTextFileChunk(filePath, offset, 101)
      reconstructed += chunk.content
      expect(chunk.content).not.toContain('\uFFFD')
      if (chunk.eof) break
      offset = chunk.nextOffset
    }

    expect(reconstructed).toBe(original)
  })

  it('aligns random seeks to the next complete line without corrupting UTF-8', async () => {
    const filePath = path.join(tempDir, 'random-seek.txt')
    const original = [
      'first line',
      'second 性能 line',
      'target 完整 line',
      'tail line',
    ].join('\n')
    await fs.writeFile(filePath, original)

    const offsetInsideSecondLine = Buffer.byteLength('first line\nsecond 性')
    const chunk = await readTextFileChunk(filePath, offsetInsideSecondLine, 128, true)

    expect(chunk.content).toBe('target 完整 line\ntail line')
    expect(chunk.content).not.toContain('\uFFFD')
    expect(chunk.startOffset).toBe(Buffer.byteLength('first line\nsecond 性能 line\n'))
    expect(chunk.nextOffset).toBe(Buffer.byteLength(original))
    expect(chunk.eof).toBe(true)
  })

  it('enforces the per-request memory ceiling', async () => {
    const filePath = path.join(tempDir, 'bounded-page.txt')
    await fs.writeFile(filePath, 'x'.repeat(6 * 1024 * 1024))

    const chunk = await readTextFileChunk(filePath, 0, 100 * 1024 * 1024)

    expect(chunk.content.length).toBe(4 * 1024 * 1024)
    expect(chunk.eof).toBe(false)
  })
})
