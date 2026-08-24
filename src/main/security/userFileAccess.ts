import * as path from 'path'

export type UserFileGrantSource = 'file-association' | 'file-picker' | 'save-picker' | 'lsp-navigation' | 'agent-read' | 'agent-write' | 'agent-manage'
export type UserFileGrantAccess = 'read' | 'write' | 'manage'


interface UserFileGrant {
  source: UserFileGrantSource
  access: UserFileGrantAccess
  grantedAt: number
}

const MAX_SESSION_GRANTS = 512
const grants = new Map<string, UserFileGrant>()

function keyFor(filePath: string): string {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** Grant this exact file for the lifetime of the application process. */
export function authorizeUserFile(filePath: string, source: UserFileGrantSource, access: UserFileGrantAccess = 'read'): void {
  try {
    const key = keyFor(filePath)
    grants.delete(key)
    grants.set(key, { source, access, grantedAt: Date.now() })
    while (grants.size > MAX_SESSION_GRANTS) {
      const oldest = grants.keys().next().value
      if (typeof oldest !== 'string') break
      grants.delete(oldest)
    }
  } catch {
    // Invalid paths never become grants.
  }
}

export function isUserAuthorizedFile(filePath: string, requiredAccess: UserFileGrantAccess = 'read'): boolean {
  try {
    const grant = grants.get(keyFor(filePath))
    if (!grant) return false
    const rank: Record<UserFileGrantAccess, number> = { read: 1, write: 2, manage: 3 }
    return rank[grant.access] >= rank[requiredAccess]
  } catch {
    return false
  }
}

export function clearUserFileGrants(): void {
  grants.clear()
}
