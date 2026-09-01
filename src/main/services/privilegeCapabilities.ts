import type { PrivilegeCapability } from '@shared/types/systemPrivilege'
import type { TranslationKey } from '@shared/i18n'

/**
 * 提权失败原因的文案键。
 *
 * 存键而不是存中英文本：这段文案会出现在主进程弹的原生 dialog 里，主进程必须能自己查 ——
 * 让渲染进程把文案传进来等于让被审批方决定审批框写什么。同一批能力在渲染侧还有一份
 * "为什么需要权限"的文案（`SystemPrivilegeCoordinator`），两边都走 locale 表就不会各存一份。
 */
export const PRIVILEGE_CAPABILITY_REASON_KEYS: Record<PrivilegeCapability, TranslationKey> = {
  'lsp.install': 'privilegeCapability.lspInstallDenied',
  'file.writeProtected': 'privilegeCapability.fileWriteProtectedDenied',
  'config.writeProtected': 'privilegeCapability.configWriteProtectedDenied',
}

export function isPrivilegeCapability(value: unknown): value is PrivilegeCapability {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PRIVILEGE_CAPABILITY_REASON_KEYS, value)
}
