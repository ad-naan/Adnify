import type { ModelMessage } from '@ai-sdk/provider-utils'
import type { ApiProtocol } from '@shared/config/providers'

export interface CacheConfig {
  enabled: boolean
  provider: 'anthropic' | 'openai' | 'custom'
}

function withAnthropicCache(message: ModelMessage): ModelMessage {
  return {
    ...message,
    providerOptions: {
      ...(message.providerOptions ?? {}),
      anthropic: {
        ...((message.providerOptions?.anthropic as Record<string, unknown> | undefined) ?? {}),
        cacheControl: { type: 'ephemeral' },
      },
    },
  }
}

/**
 * Add provider-specific prompt cache hints.
 *
 * Notes:
 * - Anthropic requires explicit cache breakpoints.
 * - OpenAI-compatible / Google-compatible caching is provider-specific and is
 *   not exposed through a universal request-level switch in this project.
 */
export function applyCaching(
  messages: ModelMessage[],
  config: CacheConfig
): ModelMessage[] {
  if (!config.enabled || messages.length === 0) {
    return messages
  }

  if (config.provider !== 'anthropic') {
    return messages
  }

  // Prefer caching stable prefix messages, while staying within Anthropic's
  // 4-breakpoint limit. If the conversation is only a single long prompt,
  // cache that message so prompt caching can still be triggered.
  const eligibleIndexes = messages
    .map((msg, index) => ({ msg, index }))
    .filter(({ msg, index }) => msg.role === 'system' || index < messages.length - 2)
    .map(({ index }) => index)

  if (eligibleIndexes.length === 0) {
    const fallbackIndex = messages.findIndex(msg => msg.role === 'system' || msg.role === 'user')
    if (fallbackIndex !== -1) {
      eligibleIndexes.push(fallbackIndex)
    }
  }

  const breakpointIndexes = new Set(eligibleIndexes.slice(0, 4))

  return messages.map((msg, index) =>
    breakpointIndexes.has(index) ? withAnthropicCache(msg) : msg
  )
}

export function getCacheConfig(provider: string, protocol?: ApiProtocol): CacheConfig {
  const effectiveProtocol = protocol ?? (provider === 'anthropic' ? 'anthropic' : 'openai')

  return {
    enabled: effectiveProtocol === 'anthropic',
    provider: effectiveProtocol === 'anthropic' ? 'anthropic' : 'openai',
  }
}
