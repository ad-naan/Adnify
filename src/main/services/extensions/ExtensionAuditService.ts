import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import type { ExtensionAuditEvent, ExtensionAuditEventType, ExtensionChangeSet } from '@shared/types/extensions'
import { logger } from '@shared/utils/Logger'
import { getUserConfigDir } from '../configPath'

export class ExtensionAuditService {
  private writeQueue: Promise<void> = Promise.resolve()

  async record(event: ExtensionAuditEventType, changeSet: ExtensionChangeSet, status?: string): Promise<void> {
    const entry: ExtensionAuditEvent = {
      id: randomUUID(),
      changeSetId: changeSet.id,
      event,
      kind: changeSet.kind,
      scope: changeSet.scope,
      source: changeSet.source,
      displayName: changeSet.displayName,
      state: changeSet.state,
      occurredAt: Date.now(),
      ...(status ? { status } : {}),
    }
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        const filePath = this.filePath()
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
        await fs.promises.appendFile(filePath, `${JSON.stringify(entry)}\n`, { encoding: 'utf-8', mode: 0o600 })
      } catch (error) {
        logger.store.error('[Extensions] Failed to persist audit event', error)
      }
    })
    await this.writeQueue
  }

  async history(limit = 50): Promise<ExtensionAuditEvent[]> {
    await this.writeQueue
    try {
      const content = await fs.promises.readFile(this.filePath(), 'utf-8')
      return content.split(/\r?\n/)
        .filter(Boolean)
        .slice(-Math.min(Math.max(limit, 1), 200))
        .map(line => JSON.parse(line) as ExtensionAuditEvent)
        .reverse()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  private filePath(): string {
    return path.join(getUserConfigDir(), 'audit', 'extension-events.jsonl')
  }
}

export const extensionAuditService = new ExtensionAuditService()
