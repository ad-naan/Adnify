import { describe, expect, it } from 'vitest'
import { criteriaFromText, parseProofGraph, summarizeProofGraph } from '@/renderer/agent/plan/proofGraph'
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
})
