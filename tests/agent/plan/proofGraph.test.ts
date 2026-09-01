import { describe, expect, it } from 'vitest'
import { buildReviewProof, criteriaFromText, parseProofGraph, stripProofGraph, summarizeProofGraph } from '@/renderer/agent/plan/proofGraph'
import type { PlanTask } from '@/renderer/agent/plan/types'

const task = (overrides: Partial<PlanTask> = {}): PlanTask => ({
  id: 'task-1', title: 'Auth', description: 'Implement auth', provider: 'p', model: 'm', role: 'coder', dependencies: [], status: 'pending', ...overrides,
})

describe('proofGraph', () => {
  it('preserves evidence when unchanged criteria are edited around', () => {
    const existing = [{ id: 'stable', text: 'Tests pass', status: 'proven' as const, evidenceIds: ['e1'] }]
    expect(criteriaFromText(['Tests pass', 'No diagnostics'], existing)).toEqual([
      existing[0],
      { id: 'criterion-2', text: 'No diagnostics', status: 'pending', evidenceIds: [] },
    ])
  })

  it('parses structured evidence without trusting unknown enum values', () => {
    const input = task({ acceptanceCriteria: [{ id: 'c1', text: 'Tests pass', status: 'pending', evidenceIds: [] }] })
    const parsed = parseProofGraph('<proof_graph>{"evidence":[{"id":"e1","type":"test","label":"unit tests","status":"passed","command":"pnpm test"}],"criteria":[{"id":"c1","status":"proven","evidenceIds":["e1"]}]}</proof_graph>', input, 'thread-1')
    expect(parsed?.acceptanceCriteria?.[0]).toMatchObject({ status: 'proven', evidenceIds: ['e1'] })
    expect(parsed?.evidence?.[0]).toMatchObject({ type: 'test', status: 'passed', sourceThreadId: 'thread-1' })
  })

  it('summarizes plan-wide proof state', () => {
    expect(summarizeProofGraph([task({ acceptanceCriteria: [
      { id: '1', text: 'a', status: 'proven', evidenceIds: [] },
      { id: '2', text: 'b', status: 'pending', evidenceIds: [] },
    ] })])).toEqual({ total: 2, proven: 1, failed: 0, pending: 1 })
  })

  describe('stripProofGraph', () => {
    it('removes every block, not just the first', () => {
      // 不带 /g 时第二块会原样留在正文里，用户看到的是一段裸 JSON。
      const text = 'done <proof_graph>{"evidence":[]}</proof_graph> and <proof_graph>{"criteria":[]}</proof_graph> ok'
      const stripped = stripProofGraph(text)
      expect(stripped).not.toContain('proof_graph')
      expect(stripped).not.toContain('{')
    })

    it('leaves text without a block untouched', () => {
      expect(stripProofGraph('  plain output  ')).toBe('plain output')
    })
  })

  describe('buildReviewProof', () => {
    it('gives each review its own evidence id within the same millisecond', () => {
      // evidenceIds 是 Set：两次复核撞到同一个 id 就会静默合并，第二次的结论消失。
      const criteria = [{ id: 'c1', text: 'x', status: 'pending' as const, evidenceIds: [] }]
      const first = buildReviewProof(task({ acceptanceCriteria: criteria }), 'th', false)
      const second = buildReviewProof(task({ acceptanceCriteria: criteria }), 'th', true)
      expect(first.evidence![0].id).not.toBe(second.evidence![0].id)
    })

    it('accumulates both reviews on the criterion instead of collapsing them', () => {
      const once = buildReviewProof(task({ acceptanceCriteria: [{ id: 'c1', text: 'x', status: 'pending', evidenceIds: [] }] }), 'th', false)
      const twice = buildReviewProof(task(once), 'th', true)
      expect(twice.evidence).toHaveLength(2)
      expect(twice.acceptanceCriteria![0].evidenceIds).toHaveLength(2)
    })
  })

  describe('criteriaFromText', () => {
    it('numbers criteria contiguously when blank lines are dropped', () => {
      expect(criteriaFromText(['a', '   ', 'b']).map(item => item.id)).toEqual(['criterion-1', 'criterion-2'])
    })
  })

  describe('parseProofGraph', () => {
    it('returns null on malformed JSON rather than throwing', () => {
      expect(parseProofGraph('<proof_graph>{not json}</proof_graph>', task(), 'th')).toBeNull()
    })

    it('falls back to safe defaults for unknown type and status values', () => {
      const text = '<proof_graph>{"evidence":[{"type":"bogus","status":"bogus","label":"L"}]}</proof_graph>'
      expect(parseProofGraph(text, task(), 'th')!.evidence![0]).toMatchObject({ type: 'manual', status: 'informational', label: 'L' })
    })

    it('only updates criteria the model actually referenced', () => {
      const existing = [
        { id: 'c1', text: 'one', status: 'pending' as const, evidenceIds: [] },
        { id: 'c2', text: 'two', status: 'pending' as const, evidenceIds: [] },
      ]
      const text = '<proof_graph>{"criteria":[{"id":"c1","status":"proven"}]}</proof_graph>'
      const result = parseProofGraph(text, task({ acceptanceCriteria: existing }), 'th')!
      expect(result.acceptanceCriteria!.map(item => item.status)).toEqual(['proven', 'pending'])
    })
  })
})
