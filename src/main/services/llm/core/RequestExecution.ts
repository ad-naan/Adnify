import type { ModelMessage, ProviderOptions } from '@ai-sdk/provider-utils'
import type { LLMConfig, LLMMessage } from '@shared/types'
import { prepareRequestCache } from './RequestCache'
import {
  buildGenerationSettings,
  buildRequestExecutionOptions,
  type GenerationSettings,
  type RequestExecutionOptions,
} from './RequestSettings'
import { executeWithGenerationRecovery } from './GenerationRecovery'
import {
  buildProtocolProviderOptions,
  buildThinkingProviderOptions,
  mergeProviderOptions,
  resolveThinkingCompatibility,
} from './ProviderCompatibility'
import { resolveCacheProtocol } from './cacheProtocol'

export interface PreparedRequest {
  messages: ModelMessage[]
  settings: GenerationSettings
  callOptions: RequestExecutionOptions
  providerOptions?: ProviderOptions
  cacheWriteTokens?: number
}

interface ExecutePreparedRequestOptions<T> {
  config: LLMConfig
  operation: string
  originalMessages?: LLMMessage[]
  baseMessages: ModelMessage[]
  systemPrompt?: string
  abortSignal?: AbortSignal
  maxCacheRetries?: number
  maxTransientRetries?: number
  execute: (prepared: PreparedRequest, attempt: number) => Promise<T>
}

export async function executePreparedRequest<T>(
  options: ExecutePreparedRequestOptions<T>
): Promise<T> {
  const {
    config,
    operation,
    originalMessages,
    baseMessages,
    systemPrompt,
    abortSignal,
    maxCacheRetries,
    maxTransientRetries,
    execute,
  } = options

  return await executeWithGenerationRecovery({
    config,
    operation,
    abortSignal,
    maxCacheRetries,
    maxTransientRetries,
    execute: async (useCache, attempt) => {
      const prepared = await prepareExecutionRequest({
        config,
        baseMessages,
        originalMessages,
        systemPrompt,
        useCache,
      })

      return await execute({
        messages: prepared.messages,
        settings: prepared.settings,
        callOptions: prepared.callOptions,
        providerOptions: prepared.providerOptions,
        cacheWriteTokens: prepared.cacheWriteTokens,
      }, attempt)
    },
  })
}

interface PrepareExecutionRequestOptions {
  config: LLMConfig
  baseMessages: ModelMessage[]
  originalMessages?: LLMMessage[]
  systemPrompt?: string
  useCache: boolean
}

export async function prepareExecutionRequest(
  options: PrepareExecutionRequestOptions,
): Promise<PreparedRequest> {
  const { config, baseMessages, originalMessages, systemPrompt, useCache } = options
  const settings = buildGenerationSettings(config)
  const callOptions = buildRequestExecutionOptions(config)

  const prepared = useCache
    ? await prepareRequestCache(config, baseMessages)
    : { messages: baseMessages, providerOptions: undefined }

  let providerOptions = mergeProviderOptions(
    prepared.providerOptions,
    buildProtocolProviderOptions(withSystemPromptInstructions(config, systemPrompt)),
  )

  const thinkingDecision = resolveThinkingCompatibility(config, originalMessages ?? [])

  if (thinkingDecision.enabled) {
    providerOptions = mergeProviderOptions(
      providerOptions,
      buildThinkingProviderOptions(config),
    )
  }

  return {
    messages: prepared.messages,
    settings,
    callOptions,
    providerOptions,
    cacheWriteTokens: prepared.cacheWriteTokens,
  }
}

function withSystemPromptInstructions(
  config: LLMConfig,
  systemPrompt?: string,
): LLMConfig {
  if (!systemPrompt || resolveCacheProtocol(config.protocol, config.provider) !== 'openai-responses') {
    return config
  }

  return {
    ...config,
    providerOptions: {
      ...config.providerOptions,
      openai: {
        ...(config.providerOptions?.openai ?? {}),
        instructions: systemPrompt,
      },
    },
  }
}
