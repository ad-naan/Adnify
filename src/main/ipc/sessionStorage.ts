import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { createHash } from 'crypto'
import * as path from 'path'
import type Store from 'electron-store'
import { getUserConfigDir } from '../services/configPath'
import { sessionStorageWorker } from '../services/session/SessionStorageWorkerClient'
import { readWorkspaceMarkerId } from '../security/workspaceHandlers'
import { resolveWorkspaceFromEvent } from './workspaceContext'
import type { SessionPatch, SessionWorkerResult } from '@shared/types/sessionPersistence'

interface SessionStorageHandlerOptions {
  getWindowWorkspace?: (windowId: number) => string[] | null
  workspaceMetaStore: Store<Record<string, unknown>>
}

interface SessionScope {
  databasePath: string
  legacySessionsDir: string
  legacyPlanDir: string
}

async function resolveScope(
  event: IpcMainInvokeEvent,
  options: SessionStorageHandlerOptions,
): Promise<SessionScope> {
  const workspace = resolveWorkspaceFromEvent(event, options)
  const root = workspace?.roots[0]
  if (!root) throw new Error('No active workspace for session storage')

  const markerId = await readWorkspaceMarkerId(root)
  const workspaceId = markerId || `path_${createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 24)}`
  const storageDir = path.join(getUserConfigDir(), 'session-storage')
  return {
    databasePath: path.join(storageDir, `${workspaceId}.sqlite3`),
    legacySessionsDir: path.join(root, '.adnify', 'sessions'),
    legacyPlanDir: path.join(root, '.adnify', 'plan'),
  }
}

function expectResult<T extends SessionWorkerResult['type']>(
  result: SessionWorkerResult,
  type: T,
): Extract<SessionWorkerResult, { type: T }> {
  if (result.type !== type) throw new Error(`Unexpected session worker response: ${result.type}`)
  return result as Extract<SessionWorkerResult, { type: T }>
}

export function registerSessionStorageHandlers(options: SessionStorageHandlerOptions): void {
  ipcMain.handle('session:open', async event => {
    const scope = await resolveScope(event, options)
    return expectResult(await sessionStorageWorker.request({
      type: 'open',
      databasePath: scope.databasePath,
      legacySessionsDir: scope.legacySessionsDir,
      legacyPlanDir: scope.legacyPlanDir,
    }), 'opened')
  })

  ipcMain.handle('session:loadCatalog', async event => {
    const scope = await resolveScope(event, options)
    return expectResult(await sessionStorageWorker.request({
      type: 'loadCatalog',
      databasePath: scope.databasePath,
    }), 'catalog').catalog
  })

  ipcMain.handle('session:loadMessages', async (event, threadId: string) => {
    if (!threadId) throw new Error('threadId is required')
    const scope = await resolveScope(event, options)
    return expectResult(await sessionStorageWorker.request({
      type: 'loadMessages',
      databasePath: scope.databasePath,
      threadId,
    }), 'messages').messages
  })

  ipcMain.handle('session:loadBranchMessages', async (event, threadId: string) => {
    if (!threadId) throw new Error('threadId is required')
    const scope = await resolveScope(event, options)
    return expectResult(await sessionStorageWorker.request({
      type: 'loadBranchMessages',
      databasePath: scope.databasePath,
      threadId,
    }), 'branchMessages').branches
  })

  ipcMain.handle('session:getStats', async event => {
    const scope = await resolveScope(event, options)
    return expectResult(await sessionStorageWorker.request({
      type: 'getStats',
      databasePath: scope.databasePath,
    }), 'stats').stats
  })

  ipcMain.handle('session:loadPlans', async event => {
    const scope = await resolveScope(event, options)
    return expectResult(await sessionStorageWorker.request({
      type: 'loadPlans',
      databasePath: scope.databasePath,
    }), 'plans').plans
  })

  ipcMain.handle('session:upsertPlan', async (event, plan: unknown) => {
    const scope = await resolveScope(event, options)
    await sessionStorageWorker.request({ type: 'upsertPlan', databasePath: scope.databasePath, plan })
    return true
  })

  ipcMain.handle('session:deletePlan', async (event, planId: string) => {
    if (!planId) throw new Error('planId is required')
    const scope = await resolveScope(event, options)
    await sessionStorageWorker.request({ type: 'deletePlan', databasePath: scope.databasePath, planId })
    return true
  })

  ipcMain.handle('session:applyPatch', async (event, patch: SessionPatch) => {
    if (!patch || !Array.isArray(patch.threads) || !Array.isArray(patch.deletedThreadIds) ||
      !Array.isArray(patch.branchThreads)) {
      throw new Error('Invalid session patch')
    }
    const scope = await resolveScope(event, options)
    await sessionStorageWorker.request({ type: 'applyPatch', databasePath: scope.databasePath, patch })
    return true
  })

  ipcMain.handle('session:clear', async event => {
    const scope = await resolveScope(event, options)
    await sessionStorageWorker.request({ type: 'clear', databasePath: scope.databasePath })
    return true
  })
}
