import { z } from 'zod'

export const HANDOFF_REQUEST_STATUSES = ['completed', 'partial', 'not_started'] as const

export type HandoffRequestStatus = (typeof HANDOFF_REQUEST_STATUSES)[number]

export interface NormalizedHandoffSummary {
  objective: string
  completedSteps: string[]
  pendingSteps: string[]
  keyDecisions: string[]
  userConstraints: string[]
  lastRequestStatus: HandoffRequestStatus
}

interface HandoffSummaryFallbacks {
  objective: string
  completedSteps: string[]
  pendingSteps: string[]
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap(item => normalizeStringList(item))
      .filter(Boolean)
  }

  const normalized = normalizeString(value)
  return normalized ? [normalized] : []
}

function dedupeStrings(values: string[]): string[] {
  const deduped: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const normalized = value.trim()
    if (!normalized) continue

    const key = normalized.toLowerCase()
    if (seen.has(key)) continue

    seen.add(key)
    deduped.push(normalized)
  }

  return deduped
}

export const HandoffSummarySchema = z.object({
  objective: z.preprocess(value => normalizeString(value), z.string()),
  completedSteps: z.preprocess(value => normalizeStringList(value), z.array(z.string())),
  pendingSteps: z.preprocess(value => normalizeStringList(value), z.array(z.string())),
  keyDecisions: z.preprocess(value => normalizeStringList(value), z.array(z.string())),
  userConstraints: z.preprocess(value => normalizeStringList(value), z.array(z.string())),
  lastRequestStatus: z.preprocess(
    value => normalizeString(value).toLowerCase(),
    z.enum(HANDOFF_REQUEST_STATUSES).catch('partial'),
  ),
}).passthrough()

export function normalizeHandoffSummary(
  candidate: unknown,
  fallbacks: HandoffSummaryFallbacks,
): NormalizedHandoffSummary {
  const parsed = HandoffSummarySchema.safeParse(candidate)
  if (!parsed.success) {
    return {
      objective: fallbacks.objective,
      completedSteps: dedupeStrings(fallbacks.completedSteps),
      pendingSteps: dedupeStrings(fallbacks.pendingSteps),
      keyDecisions: [],
      userConstraints: [],
      lastRequestStatus: 'partial',
    }
  }

  const { objective, completedSteps, pendingSteps, keyDecisions, userConstraints, lastRequestStatus } = parsed.data

  return {
    objective: objective || fallbacks.objective,
    completedSteps: dedupeStrings(completedSteps.length > 0 ? completedSteps : fallbacks.completedSteps),
    pendingSteps: dedupeStrings(pendingSteps.length > 0 ? pendingSteps : fallbacks.pendingSteps),
    keyDecisions: dedupeStrings(keyDecisions),
    userConstraints: dedupeStrings(userConstraints),
    lastRequestStatus,
  }
}

export function getStructuredOutputErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isRecoverableStructuredOutputError(error: unknown): boolean {
  const message = getStructuredOutputErrorMessage(error)

  return [
    'No object generated',
    'did not match schema',
    'No available channel',
    'generateObject',
  ].some(pattern => message.includes(pattern))
}
