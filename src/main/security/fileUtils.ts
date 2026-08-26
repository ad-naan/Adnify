import { promises as fsPromises } from 'fs'
import type { FileHandle } from 'fs/promises'
import { randomUUID } from 'crypto'
import * as iconv from 'iconv-lite'
import type { TextFileChunk } from '@shared/types/fileChunk'
import { LARGE_FILE_PAGE_BYTES } from '@shared/types/largeFile'

const MAX_TEXT_CHUNK_BYTES = 4 * 1024 * 1024

export type SupportedEncoding = 'utf-8' | 'utf-8-bom' | 'gbk' | 'gb18030'

export interface ReadFileResult {
  content: string | null
  encoding: SupportedEncoding
}

function normalizeEncoding(encoding?: string): SupportedEncoding {
  switch ((encoding || '').toLowerCase()) {
    case 'utf-8-bom':
    case 'utf8bom':
      return 'utf-8-bom'
    case 'gbk':
      return 'gbk'
    case 'gb18030':
      return 'gb18030'
    default:
      return 'utf-8'
  }
}

function decodeBuffer(buffer: Buffer, encoding: SupportedEncoding): string {
  if (encoding === 'gbk' || encoding === 'gb18030') {
    return iconv.decode(buffer, encoding)
  }

  if (encoding === 'utf-8-bom') {
    return buffer.toString('utf-8').replace(/^\uFEFF/, '')
  }

  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString('utf-8').substring(3)
  }

  return buffer.toString('utf-8')
}

function encodeContent(content: string, encoding: SupportedEncoding): Buffer {
  if (encoding === 'gbk' || encoding === 'gb18030') {
    return iconv.encode(content, encoding)
  }

  if (encoding === 'utf-8-bom') {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content, 'utf-8')])
  }

  return Buffer.from(content, 'utf-8')
}

function findCompleteUtf8Boundary(buffer: Buffer, end: number): number {
  let leadIndex = end - 1
  while (leadIndex >= 0 && (buffer[leadIndex] & 0xc0) === 0x80) leadIndex -= 1
  if (leadIndex < 0) return end

  const leadByte = buffer[leadIndex]
  const expectedBytes = leadByte < 0x80 ? 1 : leadByte < 0xe0 ? 2 : leadByte < 0xf0 ? 3 : 4
  return end - leadIndex < expectedBytes ? leadIndex : end
}

export async function readTextFileChunk(
  filePath: string,
  offset = 0,
  requestedBytes = LARGE_FILE_PAGE_BYTES,
): Promise<TextFileChunk> {
  const stats = await fsPromises.stat(filePath)
  const totalSize = stats.size
  const finiteOffset = Number.isFinite(offset) ? offset : 0
  const finiteRequestedBytes = Number.isFinite(requestedBytes) ? requestedBytes : LARGE_FILE_PAGE_BYTES
  const startOffset = Math.min(Math.max(0, Math.floor(finiteOffset)), totalSize)
  // Four bytes are enough for one complete UTF-8 code point, so even a
  // pathological tiny request always makes progress without corrupt decoding.
  const chunkBytes = Math.min(Math.max(4, Math.floor(finiteRequestedBytes)), MAX_TEXT_CHUNK_BYTES)
  if (startOffset >= totalSize) {
    return { content: '', startOffset, nextOffset: startOffset, totalSize, eof: true }
  }

  const bytesToRead = Math.min(chunkBytes, totalSize - startOffset)
  const buffer = Buffer.allocUnsafe(bytesToRead)
  const handle = await fsPromises.open(filePath, 'r')
  try {
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, startOffset)
    let end = bytesRead
    const reachesEof = startOffset + bytesRead >= totalSize

    if (!reachesEof) {
      const newline = buffer.lastIndexOf(10, bytesRead - 1)
      if (newline >= 0) {
        end = newline + 1
      } else {
        end = findCompleteUtf8Boundary(buffer, bytesRead)
        if (end === 0) {
          const firstByte = buffer[0]
          const firstCharacterBytes = firstByte < 0x80 ? 1 : firstByte < 0xe0 ? 2 : firstByte < 0xf0 ? 3 : 4
          end = Math.min(firstCharacterBytes, bytesRead)
        }
      }
    }

    const nextOffset = startOffset + end
    return {
      content: decodeBuffer(buffer.subarray(0, end), 'utf-8'),
      startOffset,
      nextOffset,
      totalSize,
      eof: nextOffset >= totalSize,
    }
  } finally {
    await handle.close()
  }
}

export async function readFileWithEncodingInfo(
  filePath: string,
  encoding?: string,
): Promise<ReadFileResult> {
  try {
    const buffer = await fsPromises.readFile(filePath)

    if (buffer.includes(0)) {
      return { content: '[binary file]', encoding: 'utf-8' }
    }

    const resolvedEncoding = normalizeEncoding(
      encoding || (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? 'utf-8-bom' : 'utf-8'),
    )

    return {
      content: decodeBuffer(buffer, resolvedEncoding),
      encoding: resolvedEncoding,
    }
  } catch {
    return { content: null, encoding: normalizeEncoding(encoding) }
  }
}

/**
 * Read a byte range from a file.
 *
 * `maxLength` is a BYTE count, not a line count. The returned text is decoded
 * with `Buffer.toString`, which replaces a multi-byte character straddling the
 * end boundary with U+FFFD rather than dropping it silently.
 *
 * This is a preview primitive: callers that need the whole file — anything that
 * parses the result or writes it back — must use `readFileWithEncodingInfo`,
 * otherwise a truncated read round-trips as a destructive write.
 */
async function readByteRange(
  filePath: string,
  start: number,
  maxLength: number,
): Promise<string | null> {
  let handle: FileHandle | null = null
  try {
    handle = await fsPromises.open(filePath, 'r')
    const buffer = Buffer.alloc(maxLength)
    const { bytesRead } = await handle.read(buffer, 0, maxLength, start)
    return buffer.toString('utf-8', 0, bytesRead)
  } catch {
    return null
  } finally {
    // The previous implementation leaked the descriptor whenever read() threw.
    await handle?.close().catch(() => { /* ignore */ })
  }
}

export interface SizedReadResult extends ReadFileResult {
  /** Byte size reported by stat, before any decoding. */
  size: number
  /** True when only a leading slice of the file was returned. */
  truncated: boolean
}

/**
 * Read a file, returning whether the result is the complete contents.
 *
 * `previewByteLimit` caps how much of an oversized file is read. Pass
 * `Infinity` to always read in full. Truncation is reported rather than
 * inferred: callers cannot detect it from content length alone, because the
 * cap is applied before they ever see the data.
 */
export async function readFileSized(
  filePath: string,
  encoding?: string,
  previewByteLimit = Number.POSITIVE_INFINITY,
): Promise<SizedReadResult> {
  const stats = await fsPromises.stat(filePath)

  if (stats.size > previewByteLimit) {
    const content = await readByteRange(filePath, 0, previewByteLimit)
    return {
      content,
      encoding: normalizeEncoding(encoding),
      size: stats.size,
      truncated: content !== null,
    }
  }

  const result = await readFileWithEncodingInfo(filePath, encoding)
  return { ...result, size: stats.size, truncated: false }
}

export async function getFileStats(filePath: string): Promise<{
  size: number
  isDirectory: boolean
  isFile: boolean
  mtime: Date
} | null> {
  try {
    const stats = await fsPromises.stat(filePath)
    return {
      size: stats.size,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      mtime: stats.mtime,
    }
  } catch {
    return null
  }
}

export async function ensureDirectory(dirPath: string): Promise<boolean> {
  try {
    await fsPromises.mkdir(dirPath, { recursive: true })
    return true
  } catch {
    return false
  }
}

export async function safeWriteFile(
  filePath: string,
  content: string,
  encoding: SupportedEncoding = 'utf-8',
): Promise<boolean> {
  try {
    await writeFileAtomic(filePath, content, encoding)
    return true
  } catch {
    return false
  }
}

export async function writeFileAtomic(
  filePath: string,
  content: string,
  encoding: SupportedEncoding = 'utf-8',
): Promise<void> {
  const tempPath = `${filePath}.tmp.${process.pid}.${randomUUID()}`

  try {
    const path = await import('path')
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true })
    await fsPromises.writeFile(tempPath, encodeContent(content, normalizeEncoding(encoding)))
    await fsPromises.rename(tempPath, filePath)
  } catch (error) {
    try {
      await fsPromises.unlink(tempPath)
    } catch {
      // ignore cleanup failure
    }
    throw error
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function safeDelete(filePath: string): Promise<boolean> {
  try {
    const stats = await fsPromises.stat(filePath)

    if (stats.isDirectory()) {
      await fsPromises.rm(filePath, { recursive: true, force: true })
    } else {
      await fsPromises.unlink(filePath)
    }

    return true
  } catch {
    return false
  }
}

export async function copyFile(src: string, dest: string): Promise<boolean> {
  try {
    const path = await import('path')
    await ensureDirectory(path.dirname(dest))
    await fsPromises.copyFile(src, dest)
    return true
  } catch {
    return false
  }
}

export async function moveFile(src: string, dest: string): Promise<boolean> {
  try {
    const path = await import('path')
    await ensureDirectory(path.dirname(dest))
    await fsPromises.rename(src, dest)
    return true
  } catch {
    return false
  }
}
