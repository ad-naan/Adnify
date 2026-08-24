import { describe, expect, it } from 'vitest'
import { normalizeReadFileArgs, resolveReadFileRequest } from '@/shared/utils/readFile'

describe('readFile utils', () => {
  it('normalizes explicit multi-file paths without line ranges', () => {
    const normalized = normalizeReadFileArgs({
      paths: ['src/a.ts', 'src/b.ts'],
      start_line: 10,
      end_line: 20,
    })

    expect(normalized.paths).toEqual(['src/a.ts', 'src/b.ts'])
    expect(normalized.path).toBeUndefined()
    expect(normalized.start_line).toBeUndefined()
    expect(normalized.end_line).toBeUndefined()
  })

  it('resolves multi-file requests from array payloads', () => {
    const result = resolveReadFileRequest({
      paths: ['src/a.ts', 'src/b.ts'],
    })

    expect(result.ok).toBe(true)
    if (result.ok && result.mode === 'multi') {
      expect(result.args.paths).toEqual(['src/a.ts', 'src/b.ts'])
    }
  })

  it('resolves single-file requests with line ranges', () => {
    const result = resolveReadFileRequest({
      path: 'src/main.ts',
      start_line: 5,
      end_line: 9,
    })

    expect(result.ok).toBe(true)
    if (result.ok && result.mode === 'single') {
      expect(result.args.start_line).toBe(5)
      expect(result.args.end_line).toBe(9)
    }
  })

  it('auto-swaps inverted line ranges instead of failing', () => {
    const result = resolveReadFileRequest({
      path: 'src/main.ts',
      start_line: 9,
      end_line: 5,
    })

    expect(result.ok).toBe(true)
    if (result.ok && result.mode === 'single') {
      expect(result.args.start_line).toBe(5)
      expect(result.args.end_line).toBe(9)
    }
  })
})
