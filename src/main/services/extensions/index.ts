import { MainExtensionAdapter } from './MainExtensionAdapter'
import { ExtensionTransactionService } from './ExtensionTransactionService'
import { extensionAuditService } from './ExtensionAuditService'

export { ExtensionTransactionService } from './ExtensionTransactionService'
export type { ExtensionTransactionAdapter, PreparedExtension } from './ExtensionTransactionService'
export { MainExtensionAdapter } from './MainExtensionAdapter'

export { extensionAuditService } from './ExtensionAuditService'

export const extensionTransactionService = new ExtensionTransactionService(
  new MainExtensionAdapter(),
  Date.now,
  undefined,
  extensionAuditService,
)
