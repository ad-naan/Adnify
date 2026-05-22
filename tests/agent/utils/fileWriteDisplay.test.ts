import { describe, expect, it } from 'vitest'
import {
  isCreateActionLabel,
  resolveFileChangeActionLabel,
  resolveWriteFileStatusText,
} from '@/renderer/agent/utils/fileWriteDisplay'

describe('fileWriteDisplay', () => {
  it('renders update for edit_file', () => {
    expect(resolveFileChangeActionLabel('edit_file', undefined, 'old', 'new')).toBe('Update')
  })

  it('renders create for write_file create intent', () => {
    expect(resolveFileChangeActionLabel('write_file', { writeIntent: 'create' }, '', 'new')).toBe('Create')
  })

  it('renders rewrite for write_file full rewrite intent', () => {
    expect(resolveFileChangeActionLabel('write_file', { writeIntent: 'full-rewrite' }, 'old', 'new')).toBe('Rewrite')
  })

  it('falls back to rewrite for write_file with old content and no intent', () => {
    expect(resolveFileChangeActionLabel('write_file', undefined, 'old', 'new')).toBe('Rewrite')
  })

  it('recognizes create label tone', () => {
    expect(isCreateActionLabel('Create')).toBe(true)
    expect(isCreateActionLabel('Rewrite')).toBe(false)
  })

  it('renders create-oriented write_file statuses', () => {
    expect(resolveWriteFileStatusText({ writeIntent: 'create' }, '', 'new', 'running', 'src/new.ts')).toBe('Creating src/new.ts')
    expect(resolveWriteFileStatusText({ writeIntent: 'create' }, '', 'new', 'success', 'src/new.ts')).toBe('Created src/new.ts')
    expect(resolveWriteFileStatusText({ writeIntent: 'create' }, '', 'new', 'error', 'src/new.ts')).toBe('Failed to create src/new.ts')
  })

  it('renders rewrite-oriented write_file statuses', () => {
    expect(resolveWriteFileStatusText({ writeIntent: 'full-rewrite' }, 'old', 'new', 'running', 'src/app.ts')).toBe('Rewriting src/app.ts')
    expect(resolveWriteFileStatusText({ writeIntent: 'full-rewrite' }, 'old', 'new', 'success', 'src/app.ts')).toBe('Rewritten src/app.ts')
    expect(resolveWriteFileStatusText({ writeIntent: 'full-rewrite' }, 'old', 'new', 'error', 'src/app.ts')).toBe('Failed to rewrite src/app.ts')
  })
})
