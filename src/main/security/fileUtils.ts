import { promises as fsPromises } from 'fs'
import * as iconv from 'iconv-lite'

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

export async function readFileWithEncoding(filePath: string): Promise<string | null> {
  const result = await readFileWithEncodingInfo(filePath)
  return result.content
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

export async function readLargeFile(
  filePath: string,
  start: number,
  maxLength: number,
): Promise<string | null> {
  try {
    const fd = await fsPromises.open(filePath, 'r')
    const buffer = Buffer.alloc(maxLength)
    const { bytesRead } = await fd.read(buffer, 0, maxLength, start)
    await fd.close()
    return buffer.toString('utf-8', 0, bytesRead)
  } catch {
    return null
  }
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
  const tempPath = `${filePath}.tmp.${Date.now()}`

  try {
    const path = await import('path')
    await ensureDirectory(path.dirname(filePath))
    await fsPromises.writeFile(tempPath, encodeContent(content, normalizeEncoding(encoding)))
    await fsPromises.rename(tempPath, filePath)
    return true
  } catch {
    try {
      await fsPromises.unlink(tempPath)
    } catch {
      // ignore cleanup failure
    }
    return false
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
