export type IndexPreferenceMode = 'structural' | 'semantic'

export interface IndexPreference {
  mode?: IndexPreferenceMode
  embedding?: {
    provider?: string
    apiKey?: string
    model?: string
    baseUrl?: string
    cacheDir?: string
  }
}

export const DEFAULT_INDEX_PREFERENCE: IndexPreference = { mode: 'structural' }

export async function loadIndexPreference(): Promise<IndexPreference> {
  const { indexPreference } = await import('./indexPreferenceStore')
  return indexPreference.hydrate()
}

export async function saveIndexPreference(value: IndexPreference): Promise<void> {
  const { indexPreference } = await import('./indexPreferenceStore')
  await indexPreference.hydrate()
  indexPreference.save(value)
}

const EMBEDDING_STRING_FIELDS = ['apiKey', 'model', 'baseUrl', 'cacheDir'] as const

export function normalizeIndexPreference(value: unknown): IndexPreference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_INDEX_PREFERENCE }

  const parsed = value as Partial<IndexPreference>
  const normalized: IndexPreference = {}

  if (parsed.mode === 'structural' || parsed.mode === 'semantic') {
    normalized.mode = parsed.mode
  }

  if (parsed.embedding && typeof parsed.embedding === 'object' && !Array.isArray(parsed.embedding)) {
    const embedding: NonNullable<IndexPreference['embedding']> = {}
    if (typeof parsed.embedding.provider === 'string' && parsed.embedding.provider.trim()) {
      embedding.provider = parsed.embedding.provider
    }
    for (const field of EMBEDDING_STRING_FIELDS) {
      const fieldValue = parsed.embedding[field]
      if (typeof fieldValue === 'string') embedding[field] = fieldValue
    }
    normalized.embedding = embedding
  }

  return normalized
}
