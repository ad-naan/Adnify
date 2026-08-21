/**
 * Parse `git ... --name-status` output into structured file changes.
 * Handles M/A/D/R/C status codes (including rename/copy with score + two paths).
 */
export interface GitNameStatusEntry {
  path: string
  oldPath?: string
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'unmerged' | 'unknown'
}

function mapStatusCode(code: string): GitNameStatusEntry['status'] {
  switch (code[0]) {
    case 'A':
      return 'added'
    case 'M':
      return 'modified'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'U':
      return 'unmerged'
    default:
      return 'unknown'
  }
}

export function parseGitNameStatus(stdout: string): GitNameStatusEntry[] {
  const entries: GitNameStatusEntry[] = []
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line.trim()) continue

    const parts = line.split('\t')
    if (parts.length < 2) continue

    const code = parts[0].trim()
    if (!code) continue

    const status = mapStatusCode(code)
    if ((status === 'renamed' || status === 'copied') && parts.length >= 3) {
      entries.push({
        status,
        oldPath: parts[1],
        path: parts[2],
      })
      continue
    }

    entries.push({
      status: status === 'unknown' ? 'modified' : status,
      path: parts[1],
    })
  }
  return entries
}
