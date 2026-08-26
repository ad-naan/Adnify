import { existsSync, mkdirSync, appendFileSync } from 'fs'
import { promises as fs } from 'fs'
import path from 'path'
import type { LogFileWriter } from '@shared/utils/Logger'

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024
const DEFAULT_MAX_FILES = 5

export function createFileLogWriter(
  logPath: string,
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
  maxFiles = DEFAULT_MAX_FILES,
): LogFileWriter {
  const logDir = path.dirname(logPath)

  const rotateIfNeeded = async (): Promise<void> => {
    const stats = await fs.stat(logPath).catch(() => null)
    if (!stats || stats.size < maxFileSize) return

    await fs.rm(path.join(logDir, `${path.basename(logPath, path.extname(logPath))}.${maxFiles}${path.extname(logPath)}`), {
      force: true,
    })

    const ext = path.extname(logPath)
    const base = path.basename(logPath, ext)
    for (let index = maxFiles - 1; index >= 1; index -= 1) {
      const source = path.join(logDir, `${base}.${index}${ext}`)
      const destination = path.join(logDir, `${base}.${index + 1}${ext}`)
      await fs.rename(source, destination).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      })
    }
    await fs.rename(logPath, path.join(logDir, `${base}.1${ext}`))
  }

  return {
    async write(lines) {
      await fs.mkdir(logDir, { recursive: true })
      await rotateIfNeeded()
      await fs.appendFile(logPath, lines, 'utf-8')
    },
    writeSync(lines) {
      if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
      appendFileSync(logPath, lines, 'utf-8')
    },
  }
}
