import path from 'path'

/** Max files/directories entries processed in one remote directory download. */
export const REMOTE_DIR_DOWNLOAD_MAX_ENTRIES = 5000

/** Max nesting depth for remote directory downloads. */
export const REMOTE_DIR_DOWNLOAD_MAX_DEPTH = 40

/**
 * Local folder that will receive a remote directory tree:
 * `<selectedParent>/<remoteDirBasename>/`
 */
export function buildDirectoryDownloadTarget(selectedParentDir: string, remoteDirectoryPath: string): string {
  const parent = path.resolve(selectedParentDir)
  const baseName = remoteDirectoryBasename(remoteDirectoryPath)
  return path.join(parent, baseName)
}

export function remoteDirectoryBasename(remoteDirectoryPath: string): string {
  const normalized = remoteDirectoryPath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalized || normalized === '/' || normalized === '.') return 'remote-download'
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || 'remote-download'
}

/** Reject unsafe single path segments (no traversal, no separators). */
export function assertSafeRemoteName(name: string): string {
  const trimmed = name.trim()
  if (
    !trimmed
    || trimmed === '.'
    || trimmed === '..'
    || trimmed.includes('/')
    || trimmed.includes('\\')
    || trimmed.includes('\0')
  ) {
    throw new Error(`Unsafe remote path segment: "${name}"`)
  }
  return trimmed
}

/**
 * Join segments under a download root and ensure the result cannot escape it.
 */
export function safeJoinUnderDownloadRoot(root: string, ...segments: string[]): string {
  const rootResolved = path.resolve(root)
  for (const segment of segments) {
    assertSafeRemoteName(segment)
  }
  const candidate = path.resolve(rootResolved, ...segments)
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : `${rootResolved}${path.sep}`
  if (candidate !== rootResolved && !candidate.startsWith(prefix)) {
    throw new Error('Download path escapes destination root')
  }
  return candidate
}

export function isSftpSymbolicLinkMode(mode?: number): boolean {
  return ((mode || 0) & 0o170000) === 0o120000
}
