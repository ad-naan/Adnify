import type { ModelMessage } from '@ai-sdk/provider-utils'
import type { LLMConfig } from '@shared/types'
import { createCacheStrategy, type RequestCacheResult } from './CacheStrategies'

export type { RequestCacheResult } from './CacheStrategies'

export async function prepareRequestCache(
  config: LLMConfig,
  messages: ModelMessage[]
): Promise<RequestCacheResult> {
  const strategy = createCacheStrategy(config)
  return await strategy.prepare(config, messages)
}
