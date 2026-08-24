import { describe, expect, it } from 'vitest'
import { LoopDetector } from '@/renderer/agent/utils/LoopDetector'

function record(detector: LoopDetector, name: string, path: string): void {
  detector.recordExecutedTool({ name, arguments: { path } }, true)
}

describe('LoopDetector semantic navigation reminder', () => {
  it('suggests semantic navigation on the third consecutive source-file read', () => {
    const detector = new LoopDetector()
    record(detector, 'read_file', 'src/a.ts')
    record(detector, 'read_file', 'src/b.ts')

    const result = detector.checkLoop([{ id: '3', name: 'read_file', arguments: { path: 'src/c.ts' } }])

    expect(result.details?.category).toBe('semantic_navigation')
    expect(result.suggestion).toContain('find_symbol')
    expect(result.isLoop).toBe(false)
  })

  it('resets the source-read burst after a symbolic tool', () => {
    const detector = new LoopDetector()
    record(detector, 'read_file', 'src/a.ts')
    record(detector, 'read_file', 'src/b.ts')
    record(detector, 'find_symbol', 'src/b.ts')

    const result = detector.checkLoop([{ id: '4', name: 'read_file', arguments: { path: 'src/c.ts' } }])
    expect(result.warning).toBeUndefined()
  })

  it('does not nudge repeated reads of non-source documents', () => {
    const detector = new LoopDetector()
    record(detector, 'read_file', 'docs/a.md')
    record(detector, 'read_file', 'docs/b.md')

    const result = detector.checkLoop([{ id: '3', name: 'read_file', arguments: { path: 'docs/c.md' } }])
    expect(result.warning).toBeUndefined()
  })
})
