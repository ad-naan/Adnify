import type { ModelMessage } from '@ai-sdk/provider-utils'
import type { LLMConfig } from '@shared/types'
import { logger } from '@shared/utils/Logger'
import { resolveHeaderPlaceholders } from '../modelFactory'
import { resolveCacheProtocol } from './cacheProtocol'
import { analyzeStablePrefix, analyzeTextOnlyStablePrefix, stripPrefixIndexes } from './CacheAnalysis'
import { isCacheFeatureUnsupported, markCacheFeatureUnsupported } from './CacheCompatibility'
import {
  buildOpenAIStyleProviderOptions,
  mergeProviderOptions,
  type RequestProviderOptions,
} from './ProviderCompatibility'

export interface RequestCacheResult {
  messages: ModelMessage[]
  providerOptions?: RequestProviderOptions
  cacheWriteTokens?: number
}

export interface CacheStrategy {
  prepare(config: LLMConfig, messages: ModelMessage[]): Promise<RequestCacheResult>
}

const MIN_OPENAI_CACHE_TOKENS = 0
const MIN_GOOGLE_IMPLICIT_CACHE_TOKENS = 0
const MIN_GOOGLE_EXPLICIT_CACHE_TOKENS = 32768
const DEFAULT_GOOGLE_CACHE_TTL_SECONDS = 3600

export function createCacheStrategy(config: LLMConfig): CacheStrategy {
  const protocol = resolveCacheProtocol(config.protocol, config.provider)

  switch (protocol) {
    case 'anthropic':
      return new AnthropicCacheStrategy()
    case 'openai':
    case 'openai-responses':
      return new OpenAICacheStrategy()
    case 'google':
      return new GoogleCacheStrategy()
    default:
      return new NoopCacheStrategy()
  }
}

class NoopCacheStrategy implements CacheStrategy {
  async prepare(_config: LLMConfig, messages: ModelMessage[]): Promise<RequestCacheResult> {
    return { messages }
  }
}

class AnthropicCacheStrategy implements CacheStrategy {
  async prepare(config: LLMConfig, messages: ModelMessage[]): Promise<RequestCacheResult> {
    if (isCacheFeatureUnsupported(config, 'anthropic-prompt-caching')) {
      return { messages }
    }

    const analysis = analyzeStablePrefix(messages)
    if (!analysis || analysis.entries.length === 0) {
      return { messages }
    }

    const breakpoints = selectAnthropicBreakpointIndexes(analysis.entries.map(entry => entry.index))
    if (breakpoints.length === 0) {
      return { messages }
    }

    const breakpointSet = new Set(breakpoints)
    return {
      messages: messages.map((message, index) =>
        breakpointSet.has(index) ? withAnthropicCacheControl(message) : message
      ),
    }
  }
}

class OpenAICacheStrategy implements CacheStrategy {
  async prepare(config: LLMConfig, messages: ModelMessage[]): Promise<RequestCacheResult> {
    if (isCacheFeatureUnsupported(config, 'openai-prompt-cache-key')) {
      return { messages }
    }

    const analysis = analyzeStablePrefix(messages)
    if (!analysis || analysis.tokenCount < MIN_OPENAI_CACHE_TOKENS) {
      return { messages }
    }

    const promptCacheKey = buildStablePromptCacheKey(config, analysis.fingerprint)
    const cacheOptions: {
      promptCacheKey: string
    } = {
      promptCacheKey,
    }

    const protocol = resolveCacheProtocol(config.protocol, config.provider)
    if (protocol === 'openai' && config.provider !== 'openai') {
      return {
        messages,
        providerOptions: {
          openaiCompatible: cacheOptions,
          'custom-openai': {
            prompt_cache_key: promptCacheKey,
          },
        } as RequestProviderOptions,
      }
    }

    return {
      messages,
      providerOptions: buildOpenAIStyleProviderOptions(config, cacheOptions),
    }
  }
}

class GoogleCacheStrategy implements CacheStrategy {
  async prepare(config: LLMConfig, messages: ModelMessage[]): Promise<RequestCacheResult> {
    const implicit = buildGoogleImplicitCacheResult(messages)

    if (isCacheFeatureUnsupported(config, 'google-explicit-cached-content')) {
      return implicit
    }

    const explicit = await googleExplicitCacheManager.prepare(config, messages)
    if (!explicit) {
      return implicit
    }

    return mergeCacheResults(implicit, explicit)
  }
}

function mergeCacheResults(
  base: RequestCacheResult,
  override: RequestCacheResult,
): RequestCacheResult {
  return {
    messages: override.messages,
    providerOptions: mergeProviderOptions(base.providerOptions, override.providerOptions),
    cacheWriteTokens: (base.cacheWriteTokens ?? 0) + (override.cacheWriteTokens ?? 0),
  }
}

function buildGoogleImplicitCacheResult(
  messages: ModelMessage[],
): RequestCacheResult {
  const analysis = analyzeStablePrefix(messages)
  if (!analysis || analysis.tokenCount < MIN_GOOGLE_IMPLICIT_CACHE_TOKENS) {
    return { messages }
  }

  return {
    messages,
    providerOptions: mergeProviderOptions(undefined, {
      google: {
        cacheConfig: {
          enabled: true,
        },
      },
    }),
  }
}

class GoogleExplicitCacheManager {
  private cache = new Map<string, { name: string; expiresAt: number; tokenCount: number }>()

  async prepare(config: LLMConfig, messages: ModelMessage[]): Promise<RequestCacheResult | null> {
    const analysis = analyzeTextOnlyStablePrefix(messages)
    if (!analysis || analysis.tokenCount < MIN_GOOGLE_EXPLICIT_CACHE_TOKENS) {
      return null
    }

    const key = `${config.model}:${analysis.fingerprint}`
    const now = Date.now()
    const cached = this.cache.get(key)

    if (cached && cached.expiresAt > now + 30_000) {
      return {
        messages: stripPrefixIndexes(messages, analysis.entries.map(entry => entry.index)),
        providerOptions: {
          google: {
            cachedContent: cached.name,
          },
        },
      }
    }

    const created = await this.createCache(config, analysis)
    if (!created) {
      return null
    }

    this.cache.set(key, created)

    logger.llm.info('[CacheStrategies] Google explicit cache created', {
      model: config.model,
      cacheName: created.name,
    })

    return {
      messages: stripPrefixIndexes(messages, analysis.entries.map(entry => entry.index)),
      providerOptions: {
        google: {
          cachedContent: created.name,
        },
      },
      cacheWriteTokens: created.tokenCount,
    }
  }

  private async createCache(
    config: LLMConfig,
    analysis: NonNullable<ReturnType<typeof analyzeTextOnlyStablePrefix>>,
  ): Promise<{ name: string; expiresAt: number; tokenCount: number } | null> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(resolveHeaderPlaceholders(config.headers, config.apiKey) ?? {}),
      }

      if (!headers['x-goog-api-key'] && config.apiKey) {
        headers['x-goog-api-key'] = config.apiKey
      }

      const url = new URL(buildGoogleCachedContentsUrl(config.baseUrl))
      if (!url.searchParams.has('key') && config.apiKey) {
        url.searchParams.set('key', config.apiKey)
      }

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: normalizeGoogleModelName(config.model),
          contents: analysis.contents,
          ...(analysis.systemInstruction
            ? {
                systemInstruction: {
                  parts: [{ text: analysis.systemInstruction }],
                },
              }
            : {}),
          ttl: `${DEFAULT_GOOGLE_CACHE_TTL_SECONDS}s`,
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`)
      }

      const data = await response.json() as { name?: string; expireTime?: string }
      if (!data.name) {
        return null
      }

      const expiresAt = data.expireTime
        ? Date.parse(data.expireTime)
        : Date.now() + DEFAULT_GOOGLE_CACHE_TTL_SECONDS * 1000

      return {
        name: data.name,
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + DEFAULT_GOOGLE_CACHE_TTL_SECONDS * 1000,
        tokenCount: analysis.tokenCount,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/cachedcontent|cached contents|cache.*not supported|unsupported/i.test(message)) {
        markCacheFeatureUnsupported(config, 'google-explicit-cached-content', message)
      }

      logger.llm.warn('[CacheStrategies] Google explicit cache unavailable', {
        model: config.model,
        error: message,
      })
      return null
    }
  }
}

const googleExplicitCacheManager = new GoogleExplicitCacheManager()

function withAnthropicCacheControl(message: ModelMessage): ModelMessage {
  if (typeof message.content === 'string') {
    return {
      ...message,
      providerOptions: mergeProviderOptions(message.providerOptions as RequestProviderOptions | undefined, {
        anthropic: {
          cacheControl: { type: 'ephemeral' },
        },
      }),
    }
  }

  if (!Array.isArray(message.content) || message.content.length === 0) {
    return message
  }

  const updatedContent = message.content.map((part, index) =>
    index === message.content.length - 1 && part?.type === 'text'
      ? {
          ...part,
          providerOptions: {
            ...((part as { providerOptions?: Record<string, unknown> }).providerOptions ?? {}),
            anthropic: {
              cacheControl: { type: 'ephemeral' },
            },
          },
        }
      : part
  )

  return {
    ...message,
    content: updatedContent,
  } as ModelMessage
}

function selectAnthropicBreakpointIndexes(prefixIndexes: number[]): number[] {
  if (prefixIndexes.length === 0) {
    return []
  }

  if (prefixIndexes.length <= 12) {
    return [prefixIndexes[prefixIndexes.length - 1]]
  }

  const selected = new Set<number>()
  const segmentCount = Math.min(4, Math.ceil(prefixIndexes.length / 8))
  for (let segment = 1; segment <= segmentCount; segment += 1) {
    const position = Math.min(
      prefixIndexes.length - 1,
      Math.floor((segment * prefixIndexes.length) / segmentCount) - 1,
    )
    selected.add(prefixIndexes[Math.max(0, position)])
  }

  return [...selected].sort((a, b) => a - b)
}

function buildStablePromptCacheKey(config: LLMConfig, prefixFingerprint: string): string {
  const protocol = resolveCacheProtocol(config.protocol, config.provider)
  const scope = `${config.provider}:${protocol}:${config.model}`
  return `${scope}:${prefixFingerprint.slice(0, 24)}`
}

function normalizeGoogleModelName(model: string): string {
  return model.startsWith('models/') ? model : `models/${model}`
}

function buildGoogleCachedContentsUrl(baseUrl?: string): string {
  const fallback = 'https://generativelanguage.googleapis.com'
  const trimmed = (baseUrl || fallback).replace(/\/$/, '')

  if (/\/v\d+(?:beta)?$/i.test(trimmed)) {
    return `${trimmed}/cachedContents`
  }

  return `${trimmed}/v1beta/cachedContents`
}
