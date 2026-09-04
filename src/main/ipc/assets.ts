import { BrowserWindow, dialog, ipcMain, safeStorage, shell, protocol, webContents } from 'electron'
import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { constants } from 'node:fs'
import { z } from 'zod'
import type { IPCContext } from './index'
import type { AssetAction, AssetCapability, AssetSnapshot } from '@shared/types/assets'
import { summarizeAssetJob } from '@shared/types/assets'
import { getUserConfigDir } from '../services/configPath'
import { AssetStorageWorkerClient } from '../services/assets/AssetStorageWorkerClient'
import { ConfigAssetRepository } from '../services/assets/ConfigAssetRepository'
import { AssetService, isInside } from '../services/assets/AssetService'
import { parseCapability } from '@shared/assets/capability'
import { logger } from '@shared/utils/Logger'
import { assetMediaResponse } from '../services/assets/assetMedia'

let service: AssetService | undefined
let repository: ConfigAssetRepository | undefined
let runtimeRepository: AssetStorageWorkerClient | undefined
let unsubscribeConfig: (() => void) | undefined
const mediaTokens = new Map<string, { assetId: string; owner: number; workspace: string }>()
const id = z.string().min(1).max(200)
const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('history'), kind: z.enum(['jobs', 'references']), page: z.number().int().min(1).max(1000000) }),
  z.object({ type: z.literal('removeHistory'), kind: z.enum(['jobs', 'references']), id }),
  z.object({ type: z.literal('clearHistory'), kind: z.enum(['jobs', 'references']) }),
  z.object({ type: z.literal('snapshot') }),
  z.object({ type: z.literal('saveCapability'), capability: z.unknown(), secret: z.string().max(16000).optional() }),
  z.object({ type: z.literal('deleteCapability'), id }),
  z.object({ type: z.literal('chooseStorage'), scope: z.enum(['global', 'project']) }),
  z.object({ type: z.literal('useProjectStorage') }),
  z.object({ type: z.literal('resetStorage'), scope: z.enum(['global', 'project']) }),
  z.object({ type: z.literal('openStorage') }),
  z.object({ type: z.literal('submit'), capabilityId: id, revision: z.number().int().positive(), inputs: z.record(z.unknown()), toolCallId: id, threadId: id.optional() }),
  ...(['job', 'retryCollection', 'cancel', 'preview', 'mediaPreview', 'openAsset'] as const).map(type => z.object({ type: z.literal(type), id })),
  z.object({ type: z.literal('import'), path: z.string().max(4000).optional() }),
  z.object({ type: z.literal('previewPath'), path: z.string().min(1).max(4000) }),
  z.object({ type: z.literal('export'), id, destination: z.string().max(4000).optional() }),
])

export function registerAssetHandlers(context: IPCContext): void {
  // Resume persisted jobs at app startup, even when no chat/settings panel is open.
  const configDir = getUserConfigDir()
  runtimeRepository = new AssetStorageWorkerClient(path.join(configDir, 'assets', 'assets.sqlite'))
  repository = new ConfigAssetRepository(runtimeRepository, context.preferencesStore, configDir)
  unsubscribeConfig = context.preferencesStore.onDidChange('assetConfiguration', value => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('settings:changed', { key: 'assetConfiguration', value })
  })
  service = new AssetService(repository, {
    configDir,
    secret: async key => {
      const encrypted = await repository!.get<string>('secret', key)
      return encrypted ? safeStorage.decryptString(Buffer.from(encrypted, 'base64')) : undefined
    },
  })
  void service.init().then(() => service?.start()).catch(error => logger.ipc.error('[Assets] Startup recovery failed', error))
  protocol.handle('adnify-asset', async request => {
    try {
      const token = new URL(request.url).hostname
      const entry = mediaTokens.get(token)
      if (!entry || !service || !webContents.fromId(entry.owner)) return new Response(null, { status: 404 })
      const root = context.getWindowWorkspace?.(entry.owner)?.[0] || ''
      if ((root ? await fs.realpath(root) : '') !== entry.workspace) return new Response(null, { status: 403 })
      const asset = await service.asset(entry.assetId, entry.workspace)
      return await assetMediaResponse(await service.filePath(asset), asset.mimeType, request)
    } catch { return new Response(null, { status: 404 }) }
  })
  ipcMain.handle('assets:request', async (event, raw: unknown) => {
    try {
      const action = actionSchema.parse(raw) as AssetAction
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) throw new Error('Asset requests require an application window')
      const root = context.getWindowWorkspace?.(event.sender.id)?.[0] || ''
      const workspace = root ? await fs.realpath(root) : ''
      if (!service || !repository) throw new Error('Asset storage is unavailable')
      await service.init()
      let result: unknown
      switch (action.type) {
        case 'history': result = await service.history(workspace, action.kind, action.page); break
        case 'removeHistory': result = await service.removeHistory(workspace, action.kind, action.id); break
        case 'clearHistory': result = await service.removeHistory(workspace, action.kind); break
        case 'snapshot': {
          const snapshot: AssetSnapshot = await service.snapshot(workspace)
          snapshot.credentials = (await Promise.all(snapshot.capabilities.map(async cap => await repository!.get('secret', cap.id) ? cap.id : null))).filter((v): v is string => !!v)
          result = snapshot; break
        }
        case 'saveCapability': {
          parseCapability(action.capability)
          let encrypted: string | undefined
          if (action.secret) {
            if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) throw new Error('OS credential encryption is unavailable')
            encrypted = safeStorage.encryptString(action.secret).toString('base64')
          }
          result = await service.saveCapability(action.capability, encrypted)
          break
        }
        case 'deleteCapability':
          // Retain credentials for already-submitted jobs; disabling prevents new submissions.
          { const cap = await repository.get<AssetCapability>('capability', action.id)
            if (cap) await service.saveCapability({ ...cap, enabled: false })
            result = true; break }
        case 'chooseStorage': {
          const selection = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: await service.effectiveRoot(workspace) })
          if (!selection.canceled && selection.filePaths[0]) await service.setStorage(workspace, action.scope, selection.filePaths[0])
          result = await service.snapshot(workspace); break
        }
        case 'useProjectStorage': await service.useProjectStorage(workspace); result = await service.snapshot(workspace); break
        case 'resetStorage': await service.setStorage(workspace, action.scope); result = await service.snapshot(workspace); break
        case 'openStorage': {
          const error = await shell.openPath(await service.effectiveRoot(workspace))
          if (error) throw new Error(error)
          result = true; break
        }
        case 'submit': result = summarizeAssetJob(await service.submit(workspace, action.capabilityId, action.revision, action.inputs, action.toolCallId, action.threadId)); break
        case 'job': result = summarizeAssetJob(await service.job(action.id, workspace)); break
        case 'retryCollection': result = summarizeAssetJob(await service.retryCollection(action.id, workspace)); break
        case 'cancel': result = summarizeAssetJob(await service.cancel(action.id, workspace)); break
        case 'import': {
          let source = action.path
          if (source) {
            source = await fs.realpath(path.resolve(workspace || '.', source))
            if (!workspace || !isInside(workspace, source)) throw new Error('Use the image picker to import files outside the workspace')
          } else {
            const selected = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] })
            if (selected.canceled) { result = null; break }
            source = selected.filePaths[0]
          }
          result = await service.importImage(source, workspace); break
        }
        case 'preview': result = await service.preview(action.id, workspace); break
        case 'previewPath': result = await service.previewPath(action.path, workspace); break
        case 'mediaPreview': {
          const asset = await service.asset(action.id, workspace)
          let url: string | undefined
          if (['video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav'].includes(asset.mimeType)) {
            // Only an opaque, workspace-authorized token crosses into the renderer.
            const token = randomUUID()
            if (mediaTokens.size >= 1000) mediaTokens.delete(mediaTokens.keys().next().value!)
            mediaTokens.set(token, { assetId: asset.id, owner: event.sender.id, workspace })
            url = `adnify-asset://${token}/media`
          }
          result = { asset, url }; break
        }
        case 'openAsset': {
          const asset = await service.asset(action.id, workspace)
          // User gesture only; do not execute arbitrary generated files.
          const file = await service.filePath(asset)
          shell.showItemInFolder(file); result = true; break
        }
        case 'export': {
          const asset = await service.asset(action.id, workspace)
          let target = action.destination
          if (target) {
            if (!workspace) throw new Error('Open a project or use the export picker')
            target = path.resolve(workspace, target)
            const parent = await fs.realpath(path.dirname(target))
            if (!isInside(workspace, parent)) throw new Error('Export target must be inside the workspace')
          } else {
            const selected = await dialog.showSaveDialog(win, { defaultPath: path.join(workspace || '', `${asset.id}-${asset.name}`) })
            if (selected.canceled || !selected.filePath) { result = null; break }
            target = selected.filePath
          }
          await fs.copyFile(await service.filePath(asset), target, constants.COPYFILE_EXCL)
          result = { assetId: asset.id, path: target, sha256: asset.sha256 }; break
        }
      }
      return { ok: true, value: result }
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Asset operation failed' } }
  })
}

export function cleanupAssetHandlers(): void { service?.stop(); unsubscribeConfig?.(); void runtimeRepository?.close(); protocol.unhandle('adnify-asset'); mediaTokens.clear() }
