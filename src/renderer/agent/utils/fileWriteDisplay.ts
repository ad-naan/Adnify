export type WriteIntentLike = 'create' | 'full-rewrite' | 'partial-update'
export type FileChangeActionLabel = 'Create' | 'Rewrite' | 'Update' | 'Rename'

function normalizeWriteIntent(meta?: Record<string, unknown>): WriteIntentLike | null {
  const value = meta?.writeIntent
  if (value === 'create' || value === 'full-rewrite' || value === 'partial-update') {
    return value
  }
  return null
}

export function resolveFileChangeActionLabel(
  toolName: string,
  meta?: Record<string, unknown>,
  oldContent = '',
  newContent = ''
): FileChangeActionLabel {
  if (toolName === 'edit_file' || toolName === 'edit_symbol') {
    return 'Update'
  }

  if (toolName === 'rename_symbol') {
    return 'Rename'
  }

  if (toolName === 'write_file') {
    const writeIntent = normalizeWriteIntent(meta)
    if (writeIntent === 'create') return 'Create'
    if (writeIntent === 'full-rewrite') return 'Rewrite'
    return !oldContent && !!newContent ? 'Create' : 'Rewrite'
  }

  return !oldContent && !!newContent ? 'Create' : 'Update'
}

export function isCreateActionLabel(label: FileChangeActionLabel): boolean {
  return label === 'Create'
}

export function resolveWriteFileStatusText(
  meta: Record<string, unknown> | undefined,
  oldContent = '',
  newContent = '',
  tense: 'running' | 'success' | 'error',
  path: string
): string {
  const action = resolveFileChangeActionLabel('write_file', meta, oldContent, newContent)
  const actionText =
    tense === 'running'
      ? (action === 'Create' ? 'Creating' : 'Rewriting')
      : tense === 'success'
        ? (action === 'Create' ? 'Created' : 'Rewritten')
        : (action === 'Create' ? 'Failed to create' : 'Failed to rewrite')

  if (!path) {
    return tense === 'running'
      ? (action === 'Create' ? 'Creating...' : 'Rewriting...')
      : actionText
  }

  return `${actionText} ${path}`
}
