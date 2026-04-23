import type { ModelMessage, ProviderOptions } from '@ai-sdk/provider-utils'
import type { LLMConfig, LLMMessage } from '@shared/types'
import { prepareRequestCache } from './RequestCache'
import { executeWithGenerationRecovery } from './GenerationRecovery'
import {
  buildProtocolProviderOptions,
  buildThinkingProviderOptions,
  mergeProviderOptions,
  resolveThinkingCompatibility,
} from './ProviderCompatibility'

export interface PreparedRequest {
  messages: ModelMessage[]
  providerOptions?: ProviderOptions
}

interface ExecutePreparedRequestOptions<T> {
  config: LLMConfig
  operation: string
  originalMessages?: LLMMessage[]
  baseMessages: ModelMessage[]
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
        useCache,
      })

      return await execute({
        messages: prepared.messages,
        providerOptions: prepared.providerOptions,
      }, attempt)
    },
  })
}

interface PrepareExecutionRequestOptions {
  config: LLMConfig
  baseMessages: ModelMessage[]
  originalMessages?: LLMMessage[]
  useCache: boolean
}

export async function prepareExecutionRequest(
  options: PrepareExecutionRequestOptions,
): Promise<PreparedRequest> {
  const { config, baseMessages, originalMessages, useCache } = options

  const prepared = useCache
    ? await prepareRequestCache(config, baseMessages)
    : { messages: baseMessages, providerOptions: undefined }

  let providerOptions = mergeProviderOptions(
    prepared.providerOptions,
    buildProtocolProviderOptions(config),
  )

  if (originalMessages) {
    const thinkingDecision = resolveThinkingCompatibility(config, originalMessages)

    if (thinkingDecision.enabled) {
      providerOptions = mergeProviderOptions(
        providerOptions,
        buildThinkingProviderOptions(config),
      )
    }
  }

  return {
    messages: prepared.messages,
    providerOptions,
  }
}
