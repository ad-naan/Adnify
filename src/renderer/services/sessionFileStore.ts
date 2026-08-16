import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import type { PersistedChatThread } from '@/renderer/agent/types'
import {
  normalizePersistedChatThread,
  parseMessagesFromJsonl,
  serializeMessages,
  stripThreadMessagesForMetadata,
  type PersistedThreadSummary,
} from './sessionStorageSupport'

interface SessionFileStorePaths {
  getSessionsDirPath: () => string
  getSessionFilePath: (fileName: string) => string
  getThreadMetaPath: (threadId: string) => string
  getThreadMessagesPath: (threadId: string) => string
}

const SESSION_READ_CONCURRENCY = 4

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0

  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++
        results[index] = await mapper(values[index])
      }
    }
  )

  await Promise.all(workers)
  return results
}

export class SessionFileStore {
  private readonly pendingReads = new Map<string, Promise<unknown | null>>()
  private readonly pendingMessageReads = new Map<string, Promise<any[]>>()
  private pendingSummaryScan: Promise<PersistedThreadSummary[]> | null = null
  private readonly pendingWrites = new Map<string, Promise<void>>()

  constructor(private readonly paths: SessionFileStorePaths) { }

  async listPersistedThreadSummaries(): Promise<PersistedThreadSummary[]> {
    if (this.pendingSummaryScan) return this.pendingSummaryScan

    const scan = this.scanPersistedThreadSummaries()
    this.pendingSummaryScan = scan
    try {
      return await scan
    } finally {
      if (this.pendingSummaryScan === scan) this.pendingSummaryScan = null
    }
  }

  private async scanPersistedThreadSummaries(): Promise<PersistedThreadSummary[]> {
    try {
      const entries = await api.file.readDir(this.paths.getSessionsDirPath())
      const threadFiles = entries.filter(entry =>
        !entry.isDirectory &&
        entry.name.endsWith('.json') &&
        !entry.name.startsWith('_')
      )

      const summaries = await mapWithConcurrency(
        threadFiles,
        SESSION_READ_CONCURRENCY,
        async (entry): Promise<PersistedThreadSummary | null> => {
          const threadId = entry.name.slice(0, -'.json'.length)
          const data = await this.readSessionFile<PersistedChatThread>(entry.name)
          if (!data) return null

          return {
            id: threadId,
            title: typeof data.title === 'string' ? data.title : undefined,
            lastModified: typeof data.lastModified === 'number' ? data.lastModified : 0,
            messageCount: typeof data.messageCount === 'number' ? data.messageCount : 0,
          } satisfies PersistedThreadSummary
        }
      )

      return summaries.filter((item): item is PersistedThreadSummary => item !== null)
    } catch (error) {
      logger.system.error('[SessionFileStore] Failed to list persisted thread summaries:', error)
      return []
    }
  }

  async readSessionFile<T>(fileName: string): Promise<T | null> {
    const existing = this.pendingReads.get(fileName)
    if (existing) return existing as Promise<T | null>

    const read = (async (): Promise<T | null> => {
      try {
        const content = await api.file.read(this.paths.getSessionFilePath(fileName))
        if (!content) return null

        if (fileName.endsWith('.json') && !fileName.startsWith('_')) {
          return stripThreadMessagesForMetadata(JSON.parse(content) as PersistedChatThread) as T
        }

        return JSON.parse(content) as T
      } catch {
        return null
      }
    })()

    this.pendingReads.set(fileName, read)
    try {
      return await read
    } finally {
      if (this.pendingReads.get(fileName) === read) this.pendingReads.delete(fileName)
    }
  }

  async writeSessionFile<T>(fileName: string, data: T): Promise<void> {
    return this.enqueueWrite(fileName, async () => {
      if (fileName.endsWith('.json') && !fileName.startsWith('_')) {
        const threadId = fileName.replace('.json', '')
        const threadData = normalizePersistedChatThread(data as PersistedChatThread)
        const { messages, ...metadata } = threadData

        // Commit the larger payload first and metadata last. Readers therefore
        // never observe a new messageCount pointing at an older JSONL payload.
        if (messages.length > 0) {
          const messagesWritten = await api.file.write(
            this.paths.getThreadMessagesPath(threadId),
            serializeMessages(messages)
          )
          if (!messagesWritten) throw new Error('message write returned false')
        } else {
          await this.deleteSessionFile(`${threadId}.jsonl`)
        }

        const metadataWritten = await api.file.write(
          this.paths.getThreadMetaPath(threadId),
          JSON.stringify(
            {
              ...metadata,
              messageCount: messages.length,
            },
            null,
            2
          )
        )
        if (!metadataWritten) throw new Error('metadata write returned false')

        return
      }

      const written = await api.file.write(
        this.paths.getSessionFilePath(fileName),
        JSON.stringify(data, null, 2)
      )
      if (!written) throw new Error('write returned false')
    }).catch(error => {
      logger.system.error(`[SessionFileStore] Failed to write session file ${fileName}:`, error)
      throw error
    })
  }

  private enqueueWrite(key: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.pendingWrites.get(key) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    this.pendingWrites.set(key, next)
    return next.finally(() => {
      if (this.pendingWrites.get(key) === next) this.pendingWrites.delete(key)
    })
  }

  async deleteSessionFile(fileName: string): Promise<void> {
    try {
      const filePath = this.paths.getSessionFilePath(fileName)
      const exists = await api.file.exists(filePath)
      if (exists) {
        await api.file.delete(filePath)
      }
    } catch (error) {
      logger.system.error(`[SessionFileStore] Failed to delete session file ${fileName}:`, error)
    }
  }

  async loadThreadMessages(threadId: string): Promise<any[]> {
    const existing = this.pendingMessageReads.get(threadId)
    if (existing) return existing

    const read = this.readThreadMessages(threadId)
    this.pendingMessageReads.set(threadId, read)
    try {
      return await read
    } finally {
      if (this.pendingMessageReads.get(threadId) === read) this.pendingMessageReads.delete(threadId)
    }
  }

  private async readThreadMessages(threadId: string): Promise<any[]> {
    try {
      const jsonlPath = this.paths.getThreadMessagesPath(threadId)
      const jsonlExists = await api.file.exists(jsonlPath)

      if (!jsonlExists) {
        return []
      }

      const jsonlContent = await api.file.read(jsonlPath)
      if (!jsonlContent) return []

      const messages = parseMessagesFromJsonl(
        jsonlContent,
        error => logger.system.warn('[SessionFileStore] Skipped invalid JSONL line', error)
      )
      logger.system.info(`[SessionFileStore] Loaded ${messages.length} messages for thread ${threadId}`)
      return messages
    } catch (error) {
      logger.system.error(`[SessionFileStore] Failed to load messages for thread ${threadId}:`, error)
      return []
    }
  }
}
