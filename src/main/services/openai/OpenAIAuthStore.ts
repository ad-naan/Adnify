import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { logger } from '@shared/utils/Logger'

export interface OpenAITokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  accountID?: string
  email?: string
  /** ChatGPT subscription tier, e.g. `plus` / `pro` / `team`. */
  planType?: string
}

const getFilePath = () => path.join(app.getPath('userData'), 'openai-auth.json')

let writeLock: Promise<void> = Promise.resolve()
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock
  let resolve!: () => void
  writeLock = new Promise(r => { resolve = r })
  return prev.then(fn).finally(() => resolve())
}

async function atomicWrite(filepath: string, data: string): Promise<void> {
  const tmp = `${filepath}.${process.pid}.tmp`
  await fs.promises.writeFile(tmp, data, { mode: 0o600 })
  await fs.promises.rename(tmp, filepath)
}

async function read(): Promise<OpenAITokens | null> {
  try {
    const content = await fs.promises.readFile(getFilePath(), 'utf-8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

export const OpenAIAuthStore = {
  get: read,

  set: (tokens: OpenAITokens) =>
    withLock(async () => {
      try {
        await atomicWrite(getFilePath(), JSON.stringify(tokens, null, 2))
      } catch (err) {
        logger.store.error('[OpenAIAuthStore] Failed to save:', err)
      }
    }),

  clear: () =>
    withLock(async () => {
      try {
        await fs.promises.unlink(getFilePath())
      } catch {
        // already gone
      }
    }),

  isExpired: async (): Promise<boolean> => {
    const tokens = await read()
    if (!tokens) return true
    return tokens.expiresAt < Date.now() + 60_000
  },
}
