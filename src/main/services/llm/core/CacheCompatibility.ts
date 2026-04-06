import type { LLMConfig } from '@shared/types'
import { logger } from '@shared/utils/Logger'

export type CacheFeature =
  | 'anthropic-prompt-caching'
  | 'openai-prompt-cache-key'
  | 'google-explicit-cached-content'

const unsupportedCacheFeatures = new Map<string, Set<CacheFeature>>()

function getConfigKey(config: Pick<LLMConfig, 'provider' | 'protocol' | 'baseUrl' | 'model'>): string {
  return JSON.stringify({
    provider: config.provider,
    protocol: config.protocol || '',
    baseUrl: config.baseUrl || '',
    model: config.model,
  })
}

export function isCacheFeatureUnsupported(
  config: Pick<LLMConfig, 'provider' | 'protocol' | 'baseUrl' | 'model'>,
  feature: CacheFeature
): boolean {
  return unsupportedCacheFeatures.get(getConfigKey(config))?.has(feature) ?? false
}

export function markCacheFeatureUnsupported(
  config: Pick<LLMConfig, 'provider' | 'protocol' | 'baseUrl' | 'model'>,
  feature: CacheFeature,
  reason?: string
): void {
  const key = getConfigKey(config)
  const features = unsupportedCacheFeatures.get(key) ?? new Set<CacheFeature>()
  features.add(feature)
  unsupportedCacheFeatures.set(key, features)

  logger.llm.warn('[CacheCompatibility] Disabled unsupported cache feature for provider', {
    provider: config.provider,
    protocol: config.protocol,
    model: config.model,
    baseUrl: config.baseUrl,
    feature,
    reason,
  })
}

export function detectUnsupportedCacheFeature(
  error: unknown,
  config: Pick<LLMConfig, 'provider' | 'protocol' | 'baseUrl' | 'model'>
): CacheFeature | null {
  const message = error instanceof Error ? error.message : String(error)
  const haystack = buildErrorSearchText(error, message)
  const normalized = haystack.toLowerCase()
  const protocol = config.protocol || ''

  if (
    /unsupported parameter\(s\):\s*`?promptcachekey`?/i.test(haystack) ||
    /unknown parameter.*promptcachekey/i.test(haystack) ||
    /unsupported.*prompt_cache_key/i.test(haystack)
  ) {
    return 'openai-prompt-cache-key'
  }

  if (
    /cachedcontent/i.test(haystack) &&
    (/unsupported|unknown|invalid|validation/i.test(haystack) || normalized.includes('not found'))
  ) {
    return 'google-explicit-cached-content'
  }

  if (
    /cache[_ ]control/i.test(haystack) &&
    /unsupported|unknown|invalid|validation/i.test(haystack)
  ) {
    return 'anthropic-prompt-caching'
  }

  if ((config.provider === 'gemini' || protocol === 'google') && /cachedcontents/i.test(normalized)) {
    return 'google-explicit-cached-content'
  }

  if ((config.provider === 'anthropic' || protocol === 'anthropic') && /cache/i.test(normalized) && /validation/i.test(normalized)) {
    return 'anthropic-prompt-caching'
  }

  return null
}

export function getCacheFeatureErrorReason(error: unknown): string {
  const fallback = error instanceof Error ? error.message : String(error)

  if (!error || typeof error !== 'object') {
    return fallback
  }

  const record = error as Record<string, unknown>
  const extraFields = ['responseBody', 'data', 'cause', 'body', 'details']

  for (const field of extraFields) {
    const message = extractReasonMessage(record[field])
    if (message) {
      return message
    }
  }

  return fallback
}

function buildErrorSearchText(error: unknown, fallback: string): string {
  const parts: string[] = [fallback]

  if (!error || typeof error !== 'object') {
    return parts.join('\n')
  }

  const record = error as Record<string, unknown>
  const extraFields = ['responseBody', 'data', 'cause', 'body', 'details']

  for (const field of extraFields) {
    const value = record[field]
    if (typeof value === 'string') {
      parts.push(value)
      continue
    }

    if (value && typeof value === 'object') {
      try {
        parts.push(JSON.stringify(value))
      } catch {
        // Ignore non-serializable fields and keep best-effort matching.
      }
    }
  }

  return parts.join('\n')
}

function extractReasonMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    try {
      const parsed = JSON.parse(trimmed) as unknown
      return extractReasonMessage(parsed) ?? trimmed
    } catch {
      return trimmed
    }
  }

  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const preferredFields = ['message', 'detail', 'error', 'details']

  for (const field of preferredFields) {
    const candidate = record[field]
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}
