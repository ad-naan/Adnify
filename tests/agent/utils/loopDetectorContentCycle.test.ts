import { describe, it, expect } from 'vitest'
import { LoopDetector } from '@/renderer/agent/utils/LoopDetector'

/**
 * Regression tests for content-cycle detection.
 *
 * The bug: `loop.ts` records content hashes using `meta.filePath` — an ABSOLUTE
 * path from `resolvePath()` in the tool executors — while `checkContentChange`
 * looked them up by `record.target`, the RELATIVE path from the model's
 * `args.path`. The two keys never matched, so the hash map always looked empty
 * to the reader and the "agent rewrites the same file back and forth" case was
 * never detected.
 *
 * Threshold note: `maxNoChangeEdits` = `maxSameTargetRepeats` = 8 (defaults.ts),
 * so a cycle needs 8 recorded hashes before it trips. Args are varied per
 * iteration so the exact-repeat rule doesn't pre-empt the content-cycle rule.
 */

const WORKSPACE = 'E:/Project/adnify'
const RELATIVE = 'src/a.ts'

function driveCycle(hashKey: string, iterations = 8) {
  const detector = new LoopDetector()
  for (let i = 0; i < iterations; i++) {
    detector.recordExecutedTool(
      { name: 'edit_file', arguments: { path: RELATIVE, old_string: `v${i}`, new_string: `v${i + 1}` } },
      true
    )
    // Alternate between two states: the file is being rewritten back and forth.
    detector.updateContentHashBySignature(hashKey, i % 2 === 0 ? 'AAAA' : 'BBBB')
  }
  return detector.checkLoop([
    { name: 'edit_file', arguments: { path: RELATIVE, old_string: 'vZ', new_string: 'vW' } } as never,
  ])
}

describe('LoopDetector content-cycle detection', () => {
  it('detects a cycle when hashes are keyed by the absolute path executors report', () => {
    const result = driveCycle(`${WORKSPACE}/${RELATIVE}`)
    expect(result.isLoop).toBe(true)
    expect(result.details?.category).toBe('content_cycle')
  })

  it('detects a cycle when hashes are keyed by the relative path the model sent', () => {
    const result = driveCycle(RELATIVE)
    expect(result.isLoop).toBe(true)
    expect(result.details?.category).toBe('content_cycle')
  })

  it('treats backslash and forward-slash paths as the same file', () => {
    const result = driveCycle(`${WORKSPACE}\\src\\a.ts`)
    expect(result.isLoop).toBe(true)
    expect(result.details?.category).toBe('content_cycle')
  })

  it('does not flag a file whose content keeps changing', () => {
    const detector = new LoopDetector()
    for (let i = 0; i < 8; i++) {
      detector.recordExecutedTool(
        { name: 'edit_file', arguments: { path: RELATIVE, old_string: `v${i}`, new_string: `v${i + 1}` } },
        true
      )
      detector.updateContentHashBySignature(`${WORKSPACE}/${RELATIVE}`, `unique-${i}`)
    }
    const result = detector.checkLoop([
      { name: 'edit_file', arguments: { path: RELATIVE, old_string: 'vZ', new_string: 'vW' } } as never,
    ])
    expect(result.isLoop).toBe(false)
  })

  it('does not conflate same-named files in different directories', () => {
    const detector = new LoopDetector()
    // Alternating hashes, but split across two distinct files: neither file
    // individually cycles, so this must not trip the detector.
    for (let i = 0; i < 8; i++) {
      detector.recordExecutedTool(
        { name: 'edit_file', arguments: { path: 'src/a.ts', old_string: `v${i}`, new_string: `v${i + 1}` } },
        true
      )
      const target = i % 2 === 0 ? `${WORKSPACE}/src/a.ts` : `${WORKSPACE}/tests/a.ts`
      detector.updateContentHashBySignature(target, i % 2 === 0 ? 'AAAA' : 'BBBB')
    }
    const result = detector.checkLoop([
      { name: 'edit_file', arguments: { path: 'src/a.ts', old_string: 'vZ', new_string: 'vW' } } as never,
    ])
    expect(result.isLoop).toBe(false)
  })
})
