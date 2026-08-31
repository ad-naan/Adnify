import type {
  AcceptanceCriterion,
  PlanEvidence,
  PlanEvidenceStatus,
  PlanEvidenceType,
  PlanTask,
} from './types'

const PROOF_RE = /<proof_graph>\s*([\s\S]*?)\s*<\/proof_graph>/i
const EVIDENCE_TYPES = new Set<PlanEvidenceType>(['test', 'diagnostic', 'artifact', 'diff', 'review', 'manual'])
const EVIDENCE_STATUSES = new Set<PlanEvidenceStatus>(['passed', 'failed', 'informational'])

export interface ProofGraphSummary {
  total: number
  proven: number
  failed: number
  pending: number
}

export function criteriaFromText(lines: string[], existing: AcceptanceCriterion[] = []): AcceptanceCriterion[] {
  const previous = new Map(existing.map(item => [item.text.trim(), item]))
  return lines.map((text, index) => {
    const normalized = text.trim()
    const found = previous.get(normalized)
    return found || { id: `criterion-${index + 1}`, text: normalized, status: 'pending' as const, evidenceIds: [] }
  }).filter(item => item.text.length > 0)
}

export function summarizeProofGraph(tasks: PlanTask[]): ProofGraphSummary {
  const criteria = tasks.flatMap(task => task.acceptanceCriteria || [])
  return {
    total: criteria.length,
    proven: criteria.filter(item => item.status === 'proven').length,
    failed: criteria.filter(item => item.status === 'failed').length,
    pending: criteria.filter(item => item.status === 'pending').length,
  }
}

export function buildReviewProof(task: PlanTask, threadId: string, accepted: boolean): Pick<PlanTask, 'acceptanceCriteria' | 'evidence'> {
  const evidence: PlanEvidence = {
    id: `review-${Date.now()}`,
    type: 'review',
    label: accepted ? 'Reviewer accepted the implementation' : 'Reviewer found unresolved issues',
    status: accepted ? 'passed' : 'failed',
    sourceThreadId: threadId,
    createdAt: Date.now(),
  }
  return {
    evidence: [...(task.evidence || []), evidence],
    acceptanceCriteria: (task.acceptanceCriteria || []).map(item => ({
      ...item,
      status: accepted ? 'proven' : 'failed',
      evidenceIds: Array.from(new Set([...item.evidenceIds, evidence.id])),
    })),
  }
}

export function parseProofGraph(text: string, task: PlanTask, threadId: string): Pick<PlanTask, 'acceptanceCriteria' | 'evidence'> | null {
  const match = PROOF_RE.exec(text)
  if (!match) return null
  try {
    const value = JSON.parse(match[1]) as {
      evidence?: Array<Partial<PlanEvidence>>
      criteria?: Array<{ id?: string; status?: AcceptanceCriterion['status']; evidenceIds?: string[] }>
    }
    const now = Date.now()
    const evidence = (value.evidence || []).map((item, index): PlanEvidence => ({
      id: item.id?.trim() || `evidence-${now}-${index}`,
      type: item.type && EVIDENCE_TYPES.has(item.type) ? item.type : 'manual',
      label: item.label?.trim() || 'Execution evidence',
      summary: item.summary?.trim() || undefined,
      status: item.status && EVIDENCE_STATUSES.has(item.status) ? item.status : 'informational',
      command: item.command?.trim() || undefined,
      path: item.path?.trim() || undefined,
      sourceThreadId: threadId,
      createdAt: now,
    }))
    const updates = new Map((value.criteria || []).map(item => [item.id, item]))
    const criteria = (task.acceptanceCriteria || []).map(item => {
      const update = updates.get(item.id)
      return update ? {
        ...item,
        status: update.status || item.status,
        evidenceIds: Array.from(new Set([...(item.evidenceIds || []), ...(update.evidenceIds || [])])),
      } : item
    })
    return { evidence: [...(task.evidence || []), ...evidence], acceptanceCriteria: criteria }
  } catch {
    return null
  }
}

export function stripProofGraph(text: string): string {
  return text.replace(PROOF_RE, '').trim()
}
