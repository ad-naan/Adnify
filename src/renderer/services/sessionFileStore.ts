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

export class SessionFileStore {
  constructor(private readonly paths: SessionFileStorePaths) { }

  async listPersistedThreadSummaries(): Promise<PersistedThreadSummary[]> {
    try {
      const entries = await api.file.readDir(this.paths.getSessionsDirPath())
      const threadFiles = entries.filter(entry =>
        !entry.isDirectory &&
        entry.name.endsWith('.json') &&
        !entry.name.startsWith('_')
      )

      const summaries = await Promise.all(
        threadFiles.map(async entry => {
          const threadId = entry.name.slice(0, -'.json'.length)
          const data = await this.readSessionFile<PersistedChatThread>(entry.name)
          if (!data) return null

          return {
            id: threadId,
            title: typeof data.title === 'string' ? data.title : undefined,
            lastModified: typeof data.lastModified === 'number' ? data.lastModified : 0,
            messageCount: typeof data.messageCount === 'number' ? data.messageCount : 0,
          } satisfies PersistedThreadSummary
        })
      )

      return summaries.filter((item): item is PersistedThreadSummary => item !== null)
    } catch (error) {
      logger.system.error('[SessionFileStore] Failed to list persisted thread summaries:', error)
      return []
    }
  }

  async readSessionFile<T>(fileName: string): Promise<T | null> {
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
  }

  async writeSessionFile<T>(fileName: string, data: T): Promise<void> {
    try {
      if (fileName.endsWith('.json') && !fileName.startsWith('_')) {
        const threadId = fileName.replace('.json', '')
        const threadData = normalizePersistedChatThread(data as PersistedChatThread)
        const { messages, ...metadata } = threadData

        await api.file.write(
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

        if (messages.length > 0) {
          await api.file.write(this.paths.getThreadMessagesPath(threadId), serializeMessages(messages))
        } else {
          await this.deleteSessionFile(`${threadId}.jsonl`)
        }

        return
      }

      await api.file.write(this.paths.getSessionFilePath(fileName), JSON.stringify(data, null, 2))
    } catch (error) {
      logger.system.error(`[SessionFileStore] Failed to write session file ${fileName}:`, error)
    }
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
