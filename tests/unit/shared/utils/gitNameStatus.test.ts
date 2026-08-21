import { describe, expect, it } from 'vitest'
import { parseGitNameStatus } from '@/shared/utils/gitNameStatus'

describe('parseGitNameStatus', () => {
  it('parses added/modified/deleted entries', () => {
    const result = parseGitNameStatus([
      'M\tsrc/a.ts',
      'A\tsrc/b.ts',
      'D\tsrc/c.ts',
    ].join('\n'))

    expect(result).toEqual([
      { status: 'modified', path: 'src/a.ts' },
      { status: 'added', path: 'src/b.ts' },
      { status: 'deleted', path: 'src/c.ts' },
    ])
  })

  it('parses renames with old and new paths', () => {
    const result = parseGitNameStatus('R100\told/name.ts\tnew/name.ts\n')
    expect(result).toEqual([
      { status: 'renamed', oldPath: 'old/name.ts', path: 'new/name.ts' },
    ])
  })
})
