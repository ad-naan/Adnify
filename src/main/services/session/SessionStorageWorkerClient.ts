import * as path from 'node:path'
import { UtilityProcessClient } from '../process/UtilityProcessClient'
import type { SessionWorkerOperation, SessionWorkerResult } from '@shared/types/sessionPersistence'

/** SQLite, history hydration and backups run outside the application's main process. */
export class SessionStorageWorkerClient {
  private client = new UtilityProcessClient({
    entry: path.join(__dirname, 'sessionStorage.worker.js'), name: 'Adnify Session Storage', timeoutMs: 15_000,
  })
  request(operation: SessionWorkerOperation): Promise<SessionWorkerResult> { return this.client.request(operation) }
  closeAll(): Promise<void> { return this.client.close({ type: 'closeAll' }) }
}

export const sessionStorageWorker = new SessionStorageWorkerClient()
