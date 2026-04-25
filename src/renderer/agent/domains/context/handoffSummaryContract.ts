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

export const HANDOFF_SUMMARY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    objective: { type: 'string', description: 'What the user is trying to achieve' },
    completedSteps: { type: 'array', items: { type: 'string' }, description: 'What has been done' },
    pendingSteps: { type: 'array', items: { type: 'string' }, description: 'What still needs to be done' },
    keyDecisions: { type: 'array', items: { type: 'string' }, description: 'Important technical decisions' },
    userConstraints: { type: 'array', items: { type: 'string' }, description: 'Special requirements' },
    lastRequestStatus: {
      type: 'string',
      enum: [...HANDOFF_REQUEST_STATUSES],
      description: 'Status of last request',
    },
  },
  required: ['objective', 'completedSteps', 'pendingSteps', 'keyDecisions', 'userConstraints', 'lastRequestStatus'],
} as const

interface HandoffSummaryFallbacks {
  objective: string
  completedSteps: string[]
  pendingSteps: string[]
}

const HANDOFF_SUMMARY_ALIASES: Record<string, string[]> = {
  objective: ['mainObjective'],
  completedSteps: ['completedSoFar'],
  pendingSteps: ['remainingSteps', 'nextSteps'],
  keyDecisions: ['technicalDecisions'],
  userConstraints: ['specialRequirementsOrConstraints'],
  lastRequestStatus: ['lastUserRequestStatus'],
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeStatus(value: unknown): string {
  const normalized = normalizeString(value).toLowerCase().replace(/\s+/g, '_')

  if (normalized === 'incomplete' || normalized === 'in_progress') {
    return 'partial'
  }

  if (normalized === 'notstarted') {
    return 'not_started'
  }

  return normalized
}

function normalizeCandidateAliases(candidate: unknown): unknown {
  if (!isPlainRecord(candidate)) {
    return candidate
  }

  const normalized: Record<string, unknown> = { ...candidate }

  for (const [canonicalKey, aliases] of Object.entries(HANDOFF_SUMMARY_ALIASES)) {
    if (normalized[canonicalKey] !== undefined) continue

    const aliasKey = aliases.find(alias => normalized[alias] !== undefined)
    if (aliasKey) {
      normalized[canonicalKey] = normalized[aliasKey]
    }
  }

  return normalized
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
    value => normalizeStatus(value),
    z.enum(HANDOFF_REQUEST_STATUSES).catch('partial'),
  ),
}).passthrough()

const NormalizedHandoffSummarySchema = z.preprocess(normalizeCandidateAliases, HandoffSummarySchema)

export function normalizeHandoffSummary(
  candidate: unknown,
  fallbacks: HandoffSummaryFallbacks,
): NormalizedHandoffSummary {
  const parsed = NormalizedHandoffSummarySchema.safeParse(candidate)
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
  if (Array.isArray(error)) {
    if (error.length === 0) return 'Unknown structured output error'
    return error.map(item => getStructuredOutputErrorMessage(item)).join(' | ')
  }

  return error instanceof Error ? error.message : String(error)
}

export function isRecoverableStructuredOutputError(error: unknown): boolean {
  const message = getStructuredOutputErrorMessage(error)

  return [
    'No object generated',
    'did not return a response',
    'did not match schema',
    'finishReason: \'length\'',
    'finishReason: "length"',
    'No available channel',
    'generateObject',
  ].some(pattern => message.includes(pattern))
}
