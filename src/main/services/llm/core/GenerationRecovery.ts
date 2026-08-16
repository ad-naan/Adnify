import type { LLMConfig } from '@shared/types'
import { logger } from '@shared/utils/Logger'
import { ErrorCode } from '@shared/utils/errorHandler'
import {
  getCacheFeatureForConfig,
  getCacheFeatureErrorReason,
  markCacheFeatureUnsupported,
} from './CacheCompatibility'
import { LLMError } from '../types'

interface RecoveryState {
  cacheRetryCount: number
  transientRetryCount: number
}

export interface GenerationRecoveryOptions<T> {
  config: LLMConfig
  operation: string
  requestId?: string
  abortSignal?: AbortSignal
  execute: (useCache: boolean, attempt: number) => Promise<T>
  maxCacheRetries?: number
  maxTransientRetries?: number
}

export const DEFAULT_RETRYABLE_GENERATION_CODES = new Set<ErrorCode>([
  ErrorCode.NETWORK,
  ErrorCode.TIMEOUT,
  ErrorCode.LLM_EMPTY_RESPONSE,
  ErrorCode.LLM_NO_OUTPUT,
  ErrorCode.LLM_NO_CONTENT,
])

export async function executeWithGenerationRecovery<T>(
  options: GenerationRecoveryOptions<T>
): Promise<T> {
  const {
    config,
    operation,
    requestId,
    abortSignal,
    execute,
    maxCacheRetries = 1,
    maxTransientRetries = 2,
  } = options

  const state: RecoveryState = {
    cacheRetryCount: 0,
    transientRetryCount: 0,
  }

  let useCache = true
  let attempt = 0
  let cacheFallbackError: unknown

  while (true) {
    attempt += 1

    try {
      const result = await execute(useCache, attempt)

      // Cache decorations are optional optimizations. If the same request
      // failed with cache and then succeeded without it, learn that fact for
      // this exact route. This is causal runtime negotiation: no provider,
      // model, parameter-name, or error-message table is involved.
      if (state.cacheRetryCount > 0) {
        const cacheFeature = getCacheFeatureForConfig(config)
        if (cacheFeature) {
          markCacheFeatureUnsupported(
            config,
            cacheFeature,
            getCacheFeatureErrorReason(cacheFallbackError),
          )
        }
      }

      return result
    } catch (error) {
      if (abortSignal?.aborted) {
        throw new LLMError('Request was cancelled', ErrorCode.ABORTED, false)
      }

      if (useCache && state.cacheRetryCount < maxCacheRetries) {
        cacheFallbackError = error
        state.cacheRetryCount += 1
        useCache = false
        continue
      }

      const llmError = error instanceof LLMError ? error : LLMError.fromError(error)
      if (
        llmError.retryable &&
        DEFAULT_RETRYABLE_GENERATION_CODES.has(llmError.code) &&
        state.transientRetryCount < maxTransientRetries
      ) {
        state.transientRetryCount += 1

        logger.llm.warn('[GenerationRecovery] Retrying transient generation failure', {
          operation,
          provider: config.provider,
          protocol: config.protocol,
          model: config.model,
          requestId,
          code: llmError.code,
          message: llmError.message,
          attempt,
          retryAttempt: state.transientRetryCount,
          useCache,
        })

        await sleep(getGenerationRetryBackoffMs(state.transientRetryCount))
        continue
      }

      if (state.transientRetryCount > 0 || state.cacheRetryCount > 0) {
        logger.llm.error('[GenerationRecovery] Generation failed after retries', {
          operation,
          provider: config.provider,
          protocol: config.protocol,
          model: config.model,
          requestId,
          code: llmError.code,
          message: llmError.message,
          attempt,
          cacheRetries: state.cacheRetryCount,
          transientRetries: state.transientRetryCount,
        })
      }

      throw llmError
    }
  }
}

export function getGenerationRetryBackoffMs(retryAttempt: number): number {
  const base = 600
  return base * retryAttempt
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
