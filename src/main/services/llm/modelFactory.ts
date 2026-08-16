/**
 * Model Factory - create LLM model instances for different protocols.
 */

import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import type { LLMConfig } from '@shared/types/llm'
import { BUILTIN_PROVIDERS, isBuiltinProvider } from '@shared/config/providers'
import type { ApiProtocol } from '@shared/config/providers'
import { supportsFullOpenAIStyleFeatures } from '@shared/config/providers'
import { OpenAIAuthService } from '../openai/OpenAIAuthService'
import { OpenAIUsageStore } from '../openai/OpenAIUsageStore'
import { logger } from '@shared/utils/Logger'

/** ChatGPT subscription backend — OAuth tokens are ONLY valid here, not api.openai.com. */
const CHATGPT_BACKEND_URL = 'https://chatgpt.com/backend-api/codex'

/**
 * Resolve an OAuth access token for the `openai-oauth` provider and rewrite the
 * config so requests go to the ChatGPT backend instead of api.openai.com.
 *
 * Call this before `createModel` — token refresh is async, `createModel` is not.
 * For every other provider this returns the config untouched.
 */
export async function resolveAuthForConfig(config: LLMConfig): Promise<LLMConfig> {
    const isOAuthProvider = config.provider === 'openai-oauth'
    const isOpenAI = config.provider === 'openai'

    if (isOAuthProvider || (isOpenAI && !config.apiKey)) {
        const token = await OpenAIAuthService.getValidToken()
        if (token) {
            const { accountID } = await OpenAIAuthService.getStatus()
            return {
                ...config,
                apiKey: token,
                baseUrl: config.baseUrl || CHATGPT_BACKEND_URL,
                protocol: 'openai-responses',
                headers: {
                    ...config.headers,
                    ...(accountID ? { 'chatgpt-account-id': accountID } : {}),
                    originator: 'adnify',
                },
                // The ChatGPT backend has no server-side response storage —
                // requests with `store: true` (the Responses API default) are rejected.
                providerOptions: {
                    ...config.providerOptions,
                    openai: {
                        ...config.providerOptions?.openai,
                        store: false,
                    },
                },
                capabilities: {
                    ...config.capabilities,
                    // The ChatGPT backend rejects `max_output_tokens` outright
                    // (codex CLI omits it too); the model uses its own ceiling.
                    openAIResponsesSupportsMaxOutputTokens: false,
                },
            }
        }

        if (isOAuthProvider) {
            throw new Error('未登录 ChatGPT 账号，请在“设置 > 服务商”中重新登录。')
        }

        if (isOpenAI && !config.apiKey) {
            throw new Error('未配置 OpenAI API Key，请在“设置 > 服务商”中输入 API Key 或登录 ChatGPT 账号。')
        }
    }

    const builtinProvider = BUILTIN_PROVIDERS[config.provider]
    const requiresApiKey = builtinProvider ? builtinProvider.auth.type !== 'none' && builtinProvider.auth.type !== 'oauth' : true

    if (!config.apiKey && requiresApiKey) {
        throw new Error(`未配置 ${builtinProvider?.displayName || config.provider} 的 API Key，请在“设置 > 服务商”中补充配置。`)
    }

    return config
}

export interface ModelOptions {
    enableThinking?: boolean
}

interface ResolvedModelRoute {
    providerId: string
    protocol: ApiProtocol
    model: string
    apiKey: string
    baseUrl?: string
    headers?: Record<string, string>
    isBuiltin: boolean
    openAICompatibilityProfile?: LLMConfig['openAICompatibilityProfile']
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

    if (protocol === 'openai-responses') {
        return /\/v\d+(?:beta)?$/i.test(url) ? url : `${url}/v1`
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
    const route = resolveModelRoute(config)
    return createModelFromRoute(route, options)
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

function resolveModelRoute(config: LLMConfig): ResolvedModelRoute {
    const builtinProvider = isBuiltinProvider(config.provider)
        ? BUILTIN_PROVIDERS[config.provider]
        : undefined

    const protocol = (config.protocol || builtinProvider?.protocol || 'openai') as ApiProtocol

    const rawBaseUrl = config.baseUrl || builtinProvider?.baseUrl

    return {
        providerId: config.provider,
        protocol,
        model: config.model,
        apiKey: config.apiKey,
        // The ChatGPT backend path is exact — no /v1 suffix, so skip normalization.
        baseUrl:
            config.provider === 'openai-oauth'
                ? rawBaseUrl?.replace(/\/$/, '')
                : normalizeBaseUrl(rawBaseUrl, protocol),
        headers: resolveHeaderPlaceholders(config.headers, config.apiKey),
        isBuiltin: Boolean(builtinProvider),
        openAICompatibilityProfile: config.openAICompatibilityProfile,
    }
}

function createModelFromRoute(
    route: ResolvedModelRoute,
    _options: ModelOptions = {}
): LanguageModel {
    if (route.isBuiltin) {
        return createBuiltinModel(route)
    }

    return createCustomModel(route)
}

function createBuiltinModel(route: ResolvedModelRoute): LanguageModel {
    switch (route.providerId) {
        case 'openai': {
            const openai = createOpenAI({
                apiKey: route.apiKey,
                baseURL: route.baseUrl,
            })

            if (route.protocol === 'openai-responses') {
                return openai.responses(route.model)
            }

            return openai.chat(route.model)
        }

        case 'openai-oauth': {
            // apiKey here is an OAuth access token resolved by resolveAuthForConfig().
            // The ChatGPT backend only speaks the Responses API.
            const openai = createOpenAI({
                apiKey: route.apiKey,
                baseURL: route.baseUrl,
                headers: route.headers,
                // Subscription usage is only ever reported on response headers,
                // so snapshot it as requests pass through.
                fetch: async (input, init) => {
                    const response = await fetch(input as any, init as any)
                    try {
                        OpenAIUsageStore.captureFromHeaders(response.headers)
                    } catch (error) {
                        logger.llm.warn('[modelFactory] Failed to capture usage headers', {
                            error: error instanceof Error ? error.message : String(error),
                        })
                    }
                    return response
                },
            })
            return openai.responses(route.model)
        }

        case 'anthropic': {
            const anthropic = createAnthropic({
                apiKey: route.apiKey,
                baseURL: route.baseUrl,
            })
            return anthropic(route.model)
        }

        case 'gemini': {
            const google = createGoogle({
                apiKey: route.apiKey,
                baseURL: route.baseUrl,
            })
            return google(route.model)
        }

        default:
            throw new Error(`Unsupported builtin provider: ${route.providerId}`)
    }
}

function createCustomModel(
    route: ResolvedModelRoute
): LanguageModel {
    if (!route.baseUrl) {
        throw new Error('Custom provider requires baseUrl')
    }

    switch (route.protocol) {
        case 'openai': {
            const provider = createOpenAICompatible({
                name: 'custom-openai',
                apiKey: route.apiKey,
                baseURL: route.baseUrl,
                supportsStructuredOutputs: supportsFullOpenAIStyleFeatures(
                    route.providerId,
                    route.protocol,
                    route.openAICompatibilityProfile,
                ),
            })
            return provider(route.model)
        }

        case 'openai-responses': {
            const openai = createOpenAI({
                apiKey: route.apiKey,
                baseURL: route.baseUrl,
            })
            return openai.responses(route.model)
        }

        case 'anthropic': {
            const anthropic = createAnthropic({
                apiKey: route.apiKey,
                baseURL: route.baseUrl,
            })
            return anthropic(route.model)
        }

        case 'google': {
            const google = createGoogle({
                apiKey: route.apiKey,
                baseURL: route.baseUrl,
            })
            return google(route.model)
        }

        default: {
            const fallback = createOpenAICompatible({
                name: 'custom',
                apiKey: route.apiKey,
                baseURL: route.baseUrl,
                supportsStructuredOutputs: supportsFullOpenAIStyleFeatures(
                    route.providerId,
                    route.protocol,
                    route.openAICompatibilityProfile,
                ),
            })
            return fallback(route.model)
        }
    }
}
