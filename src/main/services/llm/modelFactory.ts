/**
 * Model Factory - 统一创建各协议的 LLM model 实例
 *
 * 使用 Vercel AI SDK，根据 provider 配置创建对应的 model
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
 * 智能处理 baseUrl，避免重复添加版本路径
 * AI SDK 会自动添加 /v1 等路径，所以如果用户已经提供了，需要移除
 */
function normalizeBaseUrl(baseUrl: string | undefined, _protocol: string): string | undefined {
    if (!baseUrl) return undefined

    // 移除末尾斜杠
    let url = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl

    // 如果 URL 已经包含版本号路径（如 /v1, /v4, /v1beta），移除它
    // 因为 AI SDK 会自动添加这些路径
    const versionPattern = /\/v\d+(?:beta)?$/
    if (versionPattern.test(url)) {
        url = url.replace(versionPattern, '')
    }

    return url
}

/**
 * 根据配置创建 AI SDK model 实例
 */
export function createModel(config: LLMConfig, options: ModelOptions = {}): LanguageModel {
    const { provider } = config

    // 替换 headers 中的 {{apiKey}} 占位符
    const resolvedHeaders = resolveHeaderPlaceholders(config.headers, config.apiKey)

    // 内置 provider
    if (isBuiltinProvider(provider)) {
        return createBuiltinModel({ ...config, headers: resolvedHeaders }, options)
    }

    // 自定义 provider - 根据 protocol 选择
    const protocol = config.protocol || 'openai'
    const customOptions = {
        ...options,
        headers: resolvedHeaders
    }
    return createCustomModel(protocol, config.model, config.apiKey, config.baseUrl, customOptions)
}

/** 替换 headers 值中的 {{apiKey}} 占位符 */
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

/**
 * 创建内置 provider 的 model
 */
function createBuiltinModel(
    config: LLMConfig,
    _options: ModelOptions = {}
): LanguageModel {
    const { provider, model, apiKey, baseUrl, protocol } = config
    const providerDef = BUILTIN_PROVIDERS[provider]
    if (!providerDef) {
        throw new Error(`Unknown builtin provider: ${provider}`)
    }

    // 规范化 baseUrl
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl || providerDef.baseUrl, protocol || providerDef.protocol)

    switch (provider) {
        case 'openai': {
            const openai = createOpenAI({
                apiKey,
                baseURL: normalizedBaseUrl,
                headers: config.headers,
            })

            // 基于 protocol 选择 API 端点
            if (config.protocol === 'openai-responses') {
                // Responses API (/v1/responses)
                return openai.responses(model)
            } else {
                // Chat Completions API (/v1/chat/completions) - 默认
                return openai.chat(model)
            }
        }

        case 'anthropic': {
            const anthropic = createAnthropic({
                apiKey,
                baseURL: normalizedBaseUrl,
                headers: config.headers,
            })
            // Anthropic 直接调用就是 messages API，无需 .chat()
            return anthropic(model)
        }

        case 'gemini': {
            const google = createGoogleGenerativeAI({
                apiKey,
                baseURL: normalizedBaseUrl,
                headers: config.headers,
            })
            // Google 直接调用就是 generateContent API，无需 .chat()
            return google(model)
        }

        default:
            throw new Error(`Unsupported builtin provider: ${provider}`)
    }
}

/**
 * 创建自定义 provider 的 model
 */
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

    // 规范化 baseUrl（此时 baseUrl 已确保不为 undefined）
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
            // Response API 需要使用 @ai-sdk/openai（非 compatible）
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
