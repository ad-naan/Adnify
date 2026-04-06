/**
 * Model Factory - create LLM model instances for different protocols.
 */

import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import type { LLMConfig } from '@shared/types/llm'
import { BUILTIN_PROVIDERS, isBuiltinProvider } from '@shared/config/providers'

export interface ModelOptions {
    enableThinking?: boolean
}

/**
 * Normalize base URLs for the provider SDK we are about to use.
 *
 * Notes:
 * - `createOpenAICompatible` expects the full user-provided base URL.
 * - `createAnthropic` works reliably with Anthropic-compatible gateways only
 *   when the versioned `/v1` prefix is present.
 * - Other official SDKs can derive their own versioned paths.
 */
function normalizeBaseUrl(baseUrl: string | undefined, protocol: string): string | undefined {
    if (!baseUrl) return undefined

    let url = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl

    if (protocol === 'openai') {
        return url
    }

    if (protocol === 'anthropic') {
        return /\/v1$/i.test(url) ? url : `${url}/v1`
    }

    const versionPattern = /\/v\d+(?:beta)?$/
    if (versionPattern.test(url)) {
        url = url.replace(versionPattern, '')
    }

    return url
}

export function createModel(config: LLMConfig, options: ModelOptions = {}): LanguageModel {
    const { provider } = config
    const resolvedHeaders = resolveHeaderPlaceholders(config.headers, config.apiKey)

    if (isBuiltinProvider(provider)) {
        return createBuiltinModel({ ...config, headers: resolvedHeaders }, options)
    }

    const protocol = config.protocol || 'openai'
    const customOptions = {
        ...options,
        headers: resolvedHeaders,
    }

    return createCustomModel(protocol, config.model, config.apiKey, config.baseUrl, customOptions)
}

export function resolveHeaderPlaceholders(
    headers?: Record<string, string>,
    apiKey?: string
): Record<string, string> | undefined {
    if (!headers) return undefined

    const resolved: Record<string, string> = {}
    for (const [key, value] of Object.entries(headers)) {
        resolved[key] = typeof value === 'string' ? value.replace(/\{\{apiKey\}\}/g, apiKey || '') : value
    }
    return resolved
}

function createBuiltinModel(
    config: LLMConfig,
    _options: ModelOptions = {}
): LanguageModel {
    const { provider, model, apiKey, baseUrl, protocol } = config
    const providerDef = BUILTIN_PROVIDERS[provider]
    if (!providerDef) {
        throw new Error(`Unknown builtin provider: ${provider}`)
    }

    const normalizedBaseUrl = normalizeBaseUrl(baseUrl || providerDef.baseUrl, protocol || providerDef.protocol)

    switch (provider) {
        case 'openai': {
            const openai = createOpenAI({
                apiKey,
                baseURL: normalizedBaseUrl,
                headers: config.headers,
            })

            if (config.protocol === 'openai-responses') {
                return openai.responses(model)
            }

            return openai.chat(model)
        }

        case 'anthropic': {
            const anthropic = createAnthropic({
                apiKey,
                baseURL: normalizedBaseUrl,
                headers: config.headers,
            })
            return anthropic(model)
        }

        case 'gemini': {
            const google = createGoogleGenerativeAI({
                apiKey,
                baseURL: normalizedBaseUrl,
                headers: config.headers,
            })
            return google(model)
        }

        default:
            throw new Error(`Unsupported builtin provider: ${provider}`)
    }
}

function createCustomModel(
    protocol: string,
    model: string,
    apiKey: string,
    baseUrl?: string,
    options: ModelOptions & { headers?: Record<string, string> } = {}
): LanguageModel {
    if (!baseUrl) {
        throw new Error('Custom provider requires baseUrl')
    }

    const normalizedBaseUrl = normalizeBaseUrl(baseUrl, protocol) || baseUrl

    switch (protocol) {
        case 'openai': {
            const provider = createOpenAICompatible({
                name: 'custom-openai',
                apiKey,
                baseURL: normalizedBaseUrl,
                headers: options.headers,
            })
            return provider(model)
        }

        case 'openai-responses': {
            const openai = createOpenAI({
                apiKey,
                baseURL: normalizedBaseUrl,
                headers: options.headers,
            })
            return openai.responses(model)
        }

        case 'anthropic': {
            const anthropic = createAnthropic({
                apiKey,
                baseURL: normalizedBaseUrl,
                headers: options.headers,
            })
            return anthropic(model)
        }

        case 'google': {
            const google = createGoogleGenerativeAI({
                apiKey,
                baseURL: normalizedBaseUrl,
                headers: options.headers,
            })
            return google(model)
        }

        default: {
            const fallback = createOpenAICompatible({
                name: 'custom',
                apiKey,
                baseURL: normalizedBaseUrl,
                headers: options.headers,
            })
            return fallback(model)
        }
    }
}
