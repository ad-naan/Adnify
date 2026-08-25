import type { PrivilegeCapability } from '@shared/types/systemPrivilege'

export const PRIVILEGE_CAPABILITY_COPY: Record<PrivilegeCapability, { zh: string; en: string }> = {
  'lsp.install': {
    zh: '系统拒绝了语言工具安装所需的文件访问。',
    en: 'The system denied file access required to install language tooling.',
  },
  'file.writeProtected': {
    zh: '系统拒绝写入当前文件或目录。',
    en: 'The system denied writing to the current file or directory.',
  },
  'config.writeProtected': {
    zh: '系统拒绝写入所选配置目录。',
    en: 'The system denied writing to the selected configuration directory.',
  },
}

export function isPrivilegeCapability(value: unknown): value is PrivilegeCapability {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PRIVILEGE_CAPABILITY_COPY, value)
}
