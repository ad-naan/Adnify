import { createHash } from 'node:crypto'
import type { ModelMessage, ProviderOptions } from '@ai-sdk/provider-utils'
import type { LLMConfig } from '@shared/types'
import { logger } from '@shared/utils/Logger'
import { countTokens } from '@shared/utils/tokenCounter'
import { resolveHeaderPlaceholders } from '../modelFactory'
import { applyCaching, getCacheConfig } from './PromptCache'
import { isCacheFeatureUnsupported, markCacheFeatureUnsupported } from './CacheCompatibility'

type RequestProviderOptions = ProviderOptions

interface RequestCacheResult {
  messages: ModelMessage[]
  providerOptions?: RequestProviderOptions
}

interface GoogleCacheEntry {
  name: string
  expiresAt: number
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
  ): Promise<string | null> {
    const prepared = this.prepareCacheablePrefix(messages)
    if (!prepared) return null

    const fingerprint = this.buildFingerprint(config.model, prepared)
    const now = Date.now()

    const existing = this.cache.get(fingerprint)
    if (existing && existing.expiresAt > now + 30_000) {
      return existing.name
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
      })

      logger.llm.info('[RequestCache] Google explicit cache created', {
        model: config.model,
        cacheName: response.name,
      })

      return response.name
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
  } | null {
    const prefix = extractStablePrefix(messages)
    if (prefix.length === 0) return null

    let systemInstruction = ''
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = []

    for (const message of prefix) {
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
  const protocol = config.protocol || (config.provider === 'anthropic' ? 'anthropic' : config.provider === 'gemini' ? 'google' : 'openai')

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
    const cachedContent = await googleExplicitCacheManager.ensureCache(config, messages)
    if (cachedContent) {
      providerOptions = mergeProviderOptions(providerOptions, {
        google: {
          cachedContent,
        },
      })
    }
  }

  return {
    messages: preparedMessages,
    ...(providerOptions ? { providerOptions } : {}),
  }
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
        protocol: config.protocol || 'openai',
        model: config.model,
        prefix,
      }))
      .digest('hex'),
  }

  if (/gpt-5\.1/i.test(config.model)) {
    cacheOptions.promptCacheRetention = '24h'
  }

  return mergeProviderOptions(undefined, {
    openai: cacheOptions,
    openaiCompatible: cacheOptions,
    'custom-openai': cacheOptions,
    custom: cacheOptions,
  })
}

function extractStablePrefix(messages: ModelMessage[]): ModelMessage[] {
  const prefix = messages.filter((_, index) => index < messages.length - 2 || messages[index].role === 'system')

  if (prefix.length > 0) {
    return prefix
  }

  const fallback = messages.findIndex(message => message.role === 'system' || message.role === 'user')
  return fallback === -1 ? [] : [messages[fallback]]
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

function mergeProviderOptions(
  base: RequestProviderOptions | undefined,
  extra: RequestProviderOptions
): RequestProviderOptions {
  const result: RequestProviderOptions = { ...(base ?? {}) }

  for (const [key, value] of Object.entries(extra)) {
    result[key] = {
      ...(result[key] ?? {}),
      ...value,
    }
  }

  return result
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
