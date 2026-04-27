import { createHash } from 'node:crypto'
import type { ModelMessage } from '@ai-sdk/provider-utils'
import type { LLMConfig } from '@shared/types'
import { logger } from '@shared/utils/Logger'
import { countTokens } from '@shared/utils/tokenCounter'
import { resolveHeaderPlaceholders } from '../modelFactory'
import { applyCaching, getCacheConfig } from './PromptCache'
import { isCacheFeatureUnsupported, markCacheFeatureUnsupported } from './CacheCompatibility'
import { resolveCacheProtocol } from './cacheProtocol'
import {
  buildOpenAIStyleProviderOptions,
  mergeProviderOptions,
  type RequestProviderOptions,
} from './ProviderCompatibility'

interface RequestCacheResult {
  messages: ModelMessage[]
  providerOptions?: RequestProviderOptions
  cacheWriteTokens?: number
}

interface GoogleCacheEntry {
  name: string
  expiresAt: number
  estimatedTokens: number
}

interface GoogleCacheResolution {
  name: string
  created: boolean
  estimatedTokens: number
  prefixIndexes: number[]
}

const DEFAULT_GOOGLE_CACHE_TTL_SECONDS = 3600
const MIN_OPENAI_CACHE_TOKENS = 1024
const MIN_GOOGLE_EXPLICIT_CACHE_TOKENS = 1024

class GoogleExplicitCacheManager {
  private cache = new Map<string, GoogleCacheEntry>()
  private unsupportedModels = new Map<string, number>()

  async ensureCache(
    config: LLMConfig,
    messages: ModelMessage[]
  ): Promise<GoogleCacheResolution | null> {
    const prepared = this.prepareCacheablePrefix(messages)
    if (!prepared) return null

    const fingerprint = this.buildFingerprint(config.model, prepared)
    const now = Date.now()

    const existing = this.cache.get(fingerprint)
    if (existing && existing.expiresAt > now + 30_000) {
      return {
        name: existing.name,
        created: false,
        estimatedTokens: existing.estimatedTokens,
        prefixIndexes: prepared.prefixIndexes,
      }
    }

    const unsupportedUntil = this.unsupportedModels.get(config.model)
    if (unsupportedUntil && unsupportedUntil > now) {
      return null
    }

    try {
      const response = await this.createCache(config, prepared)
      if (!response?.name) return null

      const expiresAt = response.expireTime
        ? Date.parse(response.expireTime)
        : now + DEFAULT_GOOGLE_CACHE_TTL_SECONDS * 1000

      this.cache.set(fingerprint, {
        name: response.name,
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : now + DEFAULT_GOOGLE_CACHE_TTL_SECONDS * 1000,
        estimatedTokens: prepared.estimatedTokens,
      })

      logger.llm.info('[RequestCache] Google explicit cache created', {
        model: config.model,
        cacheName: response.name,
      })

      return {
        name: response.name,
        created: true,
        estimatedTokens: prepared.estimatedTokens,
        prefixIndexes: prepared.prefixIndexes,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      if (/cachedcontent|cached contents|cache.*not supported|unsupported/i.test(message)) {
        this.unsupportedModels.set(config.model, now + 30 * 60 * 1000)
        markCacheFeatureUnsupported(config, 'google-explicit-cached-content', message)
      }

      logger.llm.warn('[RequestCache] Google explicit cache unavailable, falling back to implicit cache', {
        model: config.model,
        error: message,
      })
      return null
    }
  }

  private prepareCacheablePrefix(messages: ModelMessage[]): {
    systemInstruction?: string
    contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>
    estimatedTokens: number
    prefixIndexes: number[]
  } | null {
    const prefixEntries = extractStablePrefixEntries(messages)
    if (prefixEntries.length === 0) return null

    let systemInstruction = ''
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = []

    for (const { message } of prefixEntries) {
      if (message.role === 'system') {
        const text = getSimpleMessageText(message)
        if (!text) return null
        systemInstruction = systemInstruction ? `${systemInstruction}\n\n${text}` : text
        continue
      }

      if (message.role !== 'user' && message.role !== 'assistant') {
        return null
      }

      const text = getSimpleMessageText(message)
      if (!text) return null

      contents.push({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text }],
      })
    }

    if (!systemInstruction && contents.length === 0) return null

    const estimatedTokens = countTokens(
      JSON.stringify({
        systemInstruction,
        contents,
      })
    )

    if (estimatedTokens < MIN_GOOGLE_EXPLICIT_CACHE_TOKENS) {
      return null
    }

    return {
      ...(systemInstruction ? { systemInstruction } : {}),
      contents,
      estimatedTokens,
      prefixIndexes: prefixEntries.map(entry => entry.index),
    }
  }

  private buildFingerprint(
    model: string,
    prepared: {
      systemInstruction?: string
      contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>
    }
  ): string {
    return createHash('sha256')
      .update(JSON.stringify({ model, prepared }))
      .digest('hex')
  }

  private async createCache(
    config: LLMConfig,
    prepared: {
      systemInstruction?: string
      contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>
    }
  ): Promise<{ name?: string; expireTime?: string }> {
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
        contents: prepared.contents,
        ...(prepared.systemInstruction
          ? {
              systemInstruction: {
                parts: [{ text: prepared.systemInstruction }],
              },
            }
          : {}),
        ttl: `${DEFAULT_GOOGLE_CACHE_TTL_SECONDS}s`,
      }),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`)
    }

    return await response.json() as { name?: string; expireTime?: string }
  }
}

const googleExplicitCacheManager = new GoogleExplicitCacheManager()

export async function prepareRequestCache(
  config: LLMConfig,
  messages: ModelMessage[]
): Promise<RequestCacheResult> {
  const protocol = resolveCacheProtocol(config.protocol, config.provider)

  let preparedMessages = messages
  let providerOptions: RequestProviderOptions | undefined

  if (protocol === 'anthropic' && !isCacheFeatureUnsupported(config, 'anthropic-prompt-caching')) {
    preparedMessages = applyCaching(messages, getCacheConfig(config.provider, config.protocol))
  }

  if (
    (protocol === 'openai' || protocol === 'openai-responses') &&
    !isCacheFeatureUnsupported(config, 'openai-prompt-cache-key')
  ) {
    const openAICacheOptions = buildOpenAICacheOptions(config, messages)
    if (openAICacheOptions) {
      providerOptions = openAICacheOptions
    }
  }

  if (protocol === 'google' && !isCacheFeatureUnsupported(config, 'google-explicit-cached-content')) {
    const cacheResolution = await googleExplicitCacheManager.ensureCache(config, messages)
    if (cacheResolution) {
      providerOptions = mergeProviderOptions(providerOptions, {
        google: {
          cachedContent: cacheResolution.name,
        },
      })
      preparedMessages = stripGoogleCachedPrefix(messages, cacheResolution.prefixIndexes)
      if (cacheResolution.created) {
        return {
          messages: preparedMessages,
          providerOptions,
          cacheWriteTokens: cacheResolution.estimatedTokens,
        }
      }
    }
  }

  return {
    messages: preparedMessages,
    ...(providerOptions ? { providerOptions } : {}),
  }
}

function stripGoogleCachedPrefix(messages: ModelMessage[], prefixIndexes: number[]): ModelMessage[] {
  if (prefixIndexes.length === 0 || prefixIndexes.length >= messages.length) {
    return messages
  }

  const cachedIndexes = new Set(prefixIndexes)
  const remaining = messages.filter((_, index) => !cachedIndexes.has(index))
  return remaining.length > 0 ? remaining : messages
}

function buildOpenAICacheOptions(
  config: LLMConfig,
  messages: ModelMessage[]
): RequestProviderOptions | undefined {
  const prefix = extractStablePrefix(messages)
  if (prefix.length === 0) return undefined

  const serializedPrefix = JSON.stringify(prefix)
  if (countTokens(serializedPrefix) < MIN_OPENAI_CACHE_TOKENS) {
    return undefined
  }

  const cacheOptions: {
    promptCacheKey: string
    promptCacheRetention?: '24h'
  } = {
    promptCacheKey: createHash('sha256')
      .update(JSON.stringify({
        protocol: resolveCacheProtocol(config.protocol, config.provider),
        model: config.model,
        prefix,
      }))
      .digest('hex'),
  }

  if (/gpt-5(?:\.1|\.2)?/i.test(config.model) || /gpt-4\.1/i.test(config.model)) {
    cacheOptions.promptCacheRetention = '24h'
  }

  const protocol = resolveCacheProtocol(config.protocol, config.provider)
  if (protocol === 'openai' && config.provider !== 'openai') {
    return {
      openaiCompatible: cacheOptions,
      'custom-openai': {
        prompt_cache_key: cacheOptions.promptCacheKey,
        ...(cacheOptions.promptCacheRetention
          ? { prompt_cache_retention: cacheOptions.promptCacheRetention }
          : {}),
      },
    } as RequestProviderOptions
  }

  return mergeProviderOptions(undefined, buildOpenAIStyleProviderOptions(config, cacheOptions))
}

function extractStablePrefix(messages: ModelMessage[]): ModelMessage[] {
  return extractStablePrefixEntries(messages).map(entry => entry.message)
}

function extractStablePrefixEntries(messages: ModelMessage[]): Array<{ message: ModelMessage; index: number }> {
  const prefix = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message, index }) => index < messages.length - 2 || message.role === 'system')

  if (prefix.length > 0) {
    return prefix
  }

  const fallback = messages.findIndex(message => message.role === 'system' || message.role === 'user')
  return fallback === -1 ? [] : [{ message: messages[fallback], index: fallback }]
}

function getSimpleMessageText(message: ModelMessage): string | null {
  if (typeof message.content === 'string') {
    return message.content.trim() ? message.content : null
  }

  if (!Array.isArray(message.content)) {
    return null
  }

  const textParts: string[] = []
  for (const part of message.content) {
    if (!part || typeof part !== 'object' || part.type !== 'text' || typeof part.text !== 'string') {
      return null
    }
    textParts.push(part.text)
  }

  const text = textParts.join('\n').trim()
  return text || null
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
