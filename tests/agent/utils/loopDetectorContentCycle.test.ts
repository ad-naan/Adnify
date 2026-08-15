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
 * Detection is ADVISORY: every result is reported as `warning` with
 * `isLoop: false`, because terminating a turn on a repeated tool pattern made
 * long-running tasks unfinishable. These tests assert the warning fires (and
 * carries the right category), never that the turn is aborted.
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
    expect(result.warning).toBeTruthy()
    expect(result.details?.category).toBe('content_cycle')
    // Advisory only: detection must never terminate the turn.
    expect(result.isLoop).toBe(false)
  })

  it('detects a cycle when hashes are keyed by the relative path the model sent', () => {
    const result = driveCycle(RELATIVE)
    expect(result.warning).toBeTruthy()
    expect(result.details?.category).toBe('content_cycle')
    expect(result.isLoop).toBe(false)
  })

  it('treats backslash and forward-slash paths as the same file', () => {
    const result = driveCycle(`${WORKSPACE}\\src\\a.ts`)
    expect(result.warning).toBeTruthy()
    expect(result.details?.category).toBe('content_cycle')
    expect(result.isLoop).toBe(false)
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
    expect(result.details?.category).not.toBe('content_cycle')
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
    expect(result.details?.category).not.toBe('content_cycle')
  })
})

describe('LoopDetector never terminates a turn', () => {
  // The loop only breaks out of the turn on `isLoop`. Long tasks legitimately
  // repeat tool patterns, so every detector rule must stay advisory. If a future
  // change reintroduces `isLoop: true`, this fails loudly.

  it('reports exact argument repetition as a warning, not a loop', () => {
    const detector = new LoopDetector()
    const call = { name: 'write_file', arguments: { path: RELATIVE, content: 'same' } }
    for (let i = 0; i < 30; i++) detector.recordExecutedTool(call, true)
    const result = detector.checkLoop([call as never])
    expect(result.isLoop).toBe(false)
    expect(result.warning).toBeTruthy()
  })

  it('reports a repeating tool pattern as a warning, not a loop', () => {
    const detector = new LoopDetector()
    // The classic long-task rhythm: edit, lint, edit, lint...
    for (let i = 0; i < 12; i++) {
      detector.recordExecutedTool({ name: 'edit_file', arguments: { path: RELATIVE } }, true)
      detector.recordExecutedTool({ name: 'get_lint_errors', arguments: { path: RELATIVE } }, true)
    }
    const result = detector.checkLoop([
      { name: 'edit_file', arguments: { path: RELATIVE } } as never,
    ])
    expect(result.isLoop).toBe(false)
  })

  it('never returns isLoop for a cycling file', () => {
    expect(driveCycle(`${WORKSPACE}/${RELATIVE}`, 20).isLoop).toBe(false)
  })
})
