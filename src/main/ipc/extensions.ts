import type { IpcMainInvokeEvent } from 'electron'
import type {
  ExtensionApplyRequest,
  ExtensionPrepareRequest,
  ExtensionSearchRequest,
} from '@shared/types/extensions'
import { extensionAuditService, extensionTransactionService } from '../services/extensions'
import { extensionCredentialBroker } from '../services/extensions/ExtensionCredentialBroker'
import { safeIpcHandle } from './safeHandle'

function assertSearchRequest(request: ExtensionSearchRequest): void {
  if (!request || !['mcp', 'skill'].includes(request.kind) || typeof request.query !== 'string' || !request.query.trim() || request.query.length > 200) {
    throw new Error('Invalid extension search request')
  }
}

function assertPrepareRequest(request: ExtensionPrepareRequest): void {
  if (!request
    || !['mcp', 'skill'].includes(request.kind)
    || !['user', 'workspace'].includes(request.scope)
    || typeof request.source !== 'string'
    || !request.source.trim()
    || request.source.length > 500) {
    throw new Error('Invalid extension prepare request')
  }
}

export function registerExtensionHandlers(
  resolveWorkspace: (event: IpcMainInvokeEvent) => { roots: string[] } | null,
): void {
  safeIpcHandle('extensions:search', async (_, request: ExtensionSearchRequest) => {
    assertSearchRequest(request)
    return { success: true, results: await extensionTransactionService.search(request) }
  })

  safeIpcHandle('extensions:list', async (event) => ({
    success: true,
    installed: await extensionTransactionService.list(resolveWorkspace(event)?.roots[0]),
  }))

  safeIpcHandle('extensions:history', async (_, limit?: number) => ({
    success: true,
    auditEvents: await extensionAuditService.history(typeof limit === 'number' && Number.isInteger(limit) ? limit : undefined),
  }))

  safeIpcHandle('extensions:prepare', async (event, request: ExtensionPrepareRequest) => {
    assertPrepareRequest(request)
    const workspace = request.scope === 'workspace' ? resolveWorkspace(event) : null
    const changeSet = await extensionTransactionService.prepare({
      ...request,
      workspacePath: request.scope === 'workspace' ? workspace?.roots[0] : undefined,
    })
    return { success: true, changeSet }
  })

  safeIpcHandle('extensions:apply', async (_, request: ExtensionApplyRequest) =>
    extensionTransactionService.apply(request))

  safeIpcHandle('extensions:verify', async (_, changeSetId: string) =>
    extensionTransactionService.verify(changeSetId))

  safeIpcHandle('extensions:get', async (_, changeSetId: string) => {
    const changeSet = extensionTransactionService.get(changeSetId)
    return { success: Boolean(changeSet), changeSet, error: changeSet ? undefined : 'Unknown extension change set' }
  })

  safeIpcHandle('extensions:pendingCredentials', async () => ({
    success: true,
    changes: await extensionTransactionService.pendingCredentialChanges(),
  }))

  safeIpcHandle('extensions:credentials:status', async (_, references: string[]) => {
    if (!Array.isArray(references) || references.length > 100 || references.some(reference => typeof reference !== 'string')) {
      throw new Error('Invalid credential status request')
    }
    return { success: true, credentials: extensionCredentialBroker.status(references) }
  })

  safeIpcHandle('extensions:credentials:set', async (_, request: { reference: string; secret: string }) => {
    extensionCredentialBroker.set(request.reference, request.secret)
    return { success: true }
  })

  safeIpcHandle('extensions:credentials:remove', async (_, reference: string) => ({
    success: extensionCredentialBroker.remove(reference),
  }))
}
