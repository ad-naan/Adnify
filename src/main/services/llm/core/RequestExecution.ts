import type { ModelMessage, ProviderOptions } from '@ai-sdk/provider-utils'
import type { LLMConfig } from '@shared/types'
import { prepareRequestCache } from './RequestCache'
import { executeWithGenerationRecovery } from './GenerationRecovery'

export interface PreparedRequest {
  messages: ModelMessage[]
  providerOptions?: ProviderOptions
}

interface ExecutePreparedRequestOptions<T> {
  config: LLMConfig
  operation: string
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
      const prepared = useCache
        ? await prepareRequestCache(config, baseMessages)
        : { messages: baseMessages, providerOptions: undefined }

      return await execute(prepared, attempt)
    },
  })
}
