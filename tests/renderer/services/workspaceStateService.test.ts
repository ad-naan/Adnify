import { describe, expect, it } from 'vitest'
import type { OpenFile } from '@renderer/store/slices/fileSlice'
import { arePersistedOpenFilesEqual } from '@renderer/services/workspaceStateService'

function file(path: string, overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    path,
    content: '',
    contentState: 'loaded',
    contentLoadVersion: 1,
    isDirty: false,
    ...overrides,
  }
}

describe('workspace state persistence projection', () => {
  it('ignores content and editor-state changes that are never persisted', () => {
    const previous = [file('a.ts', { content: 'before' })]
    const current = [file('a.ts', {
      content: 'after'.repeat(100_000),
      isDirty: true,
      savedVersionId: 42,
      scrollPosition: { scrollTop: 500, scrollLeft: 10 },
    })]

    expect(arePersistedOpenFilesEqual(current, previous)).toBe(true)
  })

  it('detects persisted tab order, pinning and paths', () => {
    const previous = [file('a.ts'), file('b.ts')]

    expect(arePersistedOpenFilesEqual([file('b.ts'), file('a.ts')], previous)).toBe(false)
    expect(arePersistedOpenFilesEqual([file('a.ts', { pinned: true }), file('b.ts')], previous)).toBe(false)
    expect(arePersistedOpenFilesEqual([file('a.ts'), file('c.ts')], previous)).toBe(false)
  })

  it('detects preview metadata changes but ignores non-persisted diff tabs', () => {
    const preview = {
      sessionId: 'preview-1',
      url: 'http://localhost:3000',
      title: 'Preview',
      source: 'manual' as const,
    }
    const previous = [
      file('preview://preview-1', { kind: 'preview', preview }),
      file('diff://a.ts', { kind: 'diff' }),
    ]

    expect(arePersistedOpenFilesEqual([
      file('preview://preview-1', { kind: 'preview', preview }),
      file('diff://changed.ts', { kind: 'diff', content: 'changed' }),
    ], previous)).toBe(true)

    expect(arePersistedOpenFilesEqual([
      file('preview://preview-1', { kind: 'preview', preview: { ...preview, url: 'http://localhost:4000' } }),
    ], previous)).toBe(false)
  })
})
