import type {
  AcceptanceCriterion,
  PlanEvidence,
  PlanEvidenceStatus,
  PlanEvidenceType,
  PlanTask,
} from './types'

const PROOF_RE = /<proof_graph>\s*([\s\S]*?)\s*<\/proof_graph>/i
/** 剥离用：模型有时会分批给出多个块，不带 /g 会把第二块原样漏给用户当正文。 */
const PROOF_RE_ALL = /<proof_graph>\s*[\s\S]*?\s*<\/proof_graph>/gi
const EVIDENCE_TYPES = new Set<PlanEvidenceType>(['test', 'diagnostic', 'artifact', 'diff', 'review', 'manual'])
const EVIDENCE_STATUSES = new Set<PlanEvidenceStatus>(['passed', 'failed', 'informational'])

/**
 * 证据 id 只靠 Date.now() 会在同一毫秒内撞车（复核循环里两次 buildReviewProof 很容易
 * 落在同一毫秒），而 evidenceIds 用的是 Set —— 撞了就静默合并成一条，第二次复核的结论
 * 直接消失。加一个进程内自增计数器兜住。
 */
let evidenceSeq = 0
function evidenceId(prefix: string): string {
  evidenceSeq += 1
  return `${prefix}-${Date.now()}-${evidenceSeq}`
}

export interface ProofGraphSummary {
  total: number
  proven: number
  failed: number
  pending: number
}

export function criteriaFromText(lines: string[], existing: AcceptanceCriterion[] = []): AcceptanceCriterion[] {
  const previous = new Map(existing.map(item => [item.text.trim(), item]))
  // 先过滤再编号：留到 map 之后过滤会让空行白占一个下标（criterion-1、criterion-3），
  // 而且空字符串还可能命中 previous 里同样为空的旧条目。
  return lines.map(text => text.trim()).filter(text => text.length > 0).map((text, index) =>
    previous.get(text) || { id: `criterion-${index + 1}`, text, status: 'pending' as const, evidenceIds: [] },
  )
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
    id: evidenceId('review'),
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
    const evidence = (value.evidence || []).map((item): PlanEvidence => ({
      id: item.id?.trim() || evidenceId('evidence'),
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
  return text.replace(PROOF_RE_ALL, '').trim()
}
