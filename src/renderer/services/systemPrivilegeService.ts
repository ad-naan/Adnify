import { api } from './electronAPI'
import type { SystemPrivilegeStatus } from '@shared/types/systemPrivilege'

let statusPromise: Promise<SystemPrivilegeStatus> | null = null

export function getSystemPrivilegeStatus(): Promise<SystemPrivilegeStatus> {
  statusPromise ??= api.systemPrivilege.getStatus().catch(error => {
    statusPromise = null
    throw error
  })
  return statusPromise
}
