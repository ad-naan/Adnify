import * as path from 'path'

export type UserFileGrantSource = 'file-association' | 'file-picker' | 'save-picker' | 'lsp-navigation'

interface UserFileGrant {
  source: UserFileGrantSource
  grantedAt: number
}

const MAX_SESSION_GRANTS = 512
const grants = new Map<string, UserFileGrant>()

function keyFor(filePath: string): string {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** Grant this exact file for the lifetime of the application process. */
export function authorizeUserFile(filePath: string, source: UserFileGrantSource): void {
  try {
    const key = keyFor(filePath)
    grants.delete(key)
    grants.set(key, { source, grantedAt: Date.now() })
    while (grants.size > MAX_SESSION_GRANTS) {
      const oldest = grants.keys().next().value
      if (typeof oldest !== 'string') break
      grants.delete(oldest)
    }
  } catch {
    // Invalid paths never become grants.
  }
}

export function isUserAuthorizedFile(filePath: string): boolean {
  try {
    return grants.has(keyFor(filePath))
  } catch {
    return false
  }
}

export function clearUserFileGrants(): void {
  grants.clear()
}
