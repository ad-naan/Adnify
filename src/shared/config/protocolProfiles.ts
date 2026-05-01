import type { ApiProtocol } from './providers'

export interface ProtocolParameterProfile {
  officialParameters: string[]
  autoManagedParameters: string[]
  userFacingParameters: string[]
  advancedParameters: string[]
  compatibilityParameters: string[]
}

const PROTOCOL_PARAMETER_PROFILES: Record<ApiProtocol, ProtocolParameterProfile> = {
  openai: {
    officialParameters: [
      'model',
      'messages',
      'temperature',
      'top_p',
      'max_tokens',
      'tools',
      'tool_choice',
      'parallel_tool_calls',
      'reasoning_effort',
      'prompt_cache_key',
      'prompt_cache_retention',
    ],
    autoManagedParameters: [
      'messages',
      'system/developer role mapping',
      'tools serialization',
      'tool result round-trip',
      'prompt_cache_key',
    ],
    userFacingParameters: [
      'model',
      'temperature',
      'topP',
      'maxTokens',
      'reasoningEffort',
      'thinking',
    ],
    advancedParameters: ['protocol', 'timeout', 'headers', 'toolChoice', 'parallelToolCalls'],
    compatibilityParameters: [
      'openAICompatibilityProfile',
      'openAIReasoningModel',
      'openAIReasoningSupportsSampling',
      'openAIPromptCacheRetention',
    ],
  },
  'openai-responses': {
    officialParameters: [
      'model',
      'input',
      'instructions',
      'max_output_tokens',
      'tools',
      'tool_choice',
      'parallel_tool_calls',
      'reasoning',
      'previous_response_id',
      'prompt_cache_key',
      'prompt_cache_retention',
    ],
    autoManagedParameters: [
      'input conversion',
      'instructions injection',
      'reasoning event parsing',
      'tools serialization',
      'prompt_cache_key',
    ],
    userFacingParameters: [
      'model',
      'temperature',
      'topP',
      'maxTokens',
      'reasoningEffort',
      'thinking',
    ],
    advancedParameters: ['protocol', 'timeout', 'headers', 'toolChoice', 'parallelToolCalls'],
    compatibilityParameters: [
      'openAICompatibilityProfile',
      'openAIReasoningModel',
      'openAIReasoningSupportsSampling',
      'openAIPromptCacheRetention',
      'openAIResponsesSupportsMaxOutputTokens',
    ],
  },
  anthropic: {
    officialParameters: [
      'model',
      'system',
      'messages',
      'max_tokens',
      'thinking',
      'tools',
      'tool_choice',
      'temperature',
      'top_p',
      'top_k',
      'cache_control',
    ],
    autoManagedParameters: [
      'system block conversion',
      'message/content block conversion',
      'thinking block parsing',
      'cache_control placement',
      'tools serialization',
    ],
    userFacingParameters: [
      'model',
      'temperature',
      'topP',
      'topK',
      'maxTokens',
      'thinkingBudget',
      'reasoningEffort',
      'thinking',
    ],
    advancedParameters: ['protocol', 'timeout', 'headers', 'toolChoice'],
    compatibilityParameters: ['thinkingTagFormat'],
  },
  google: {
    officialParameters: [
      'model',
      'systemInstruction',
      'contents',
      'generationConfig',
      'thinkingConfig',
      'tools',
      'toolConfig',
      'cachedContent',
    ],
    autoManagedParameters: [
      'systemInstruction conversion',
      'contents conversion',
      'toolConfig mapping',
      'thinking event parsing',
      'cachedContent wiring',
    ],
    userFacingParameters: [
      'model',
      'temperature',
      'topP',
      'topK',
      'maxTokens',
      'thinkingBudget',
      'reasoningEffort',
      'thinking',
    ],
    advancedParameters: ['protocol', 'timeout', 'headers', 'toolChoice'],
    compatibilityParameters: ['googleThinkingMode', 'thinkingTagFormat'],
  },
  custom: {
    officialParameters: [],
    autoManagedParameters: ['protocol-specific mapping depends on selected protocol'],
    userFacingParameters: ['model', 'temperature', 'topP', 'topK', 'maxTokens', 'thinking'],
    advancedParameters: ['protocol', 'timeout', 'headers', 'toolChoice', 'parallelToolCalls'],
    compatibilityParameters: [
      'openAICompatibilityProfile',
      'openAIReasoningModel',
      'openAIReasoningSupportsSampling',
      'openAIPromptCacheRetention',
      'openAIResponsesSupportsMaxOutputTokens',
      'googleThinkingMode',
      'thinkingTagFormat',
    ],
  },
}

export function getProtocolParameterProfile(
  protocol: ApiProtocol | undefined,
): ProtocolParameterProfile {
  return PROTOCOL_PARAMETER_PROFILES[protocol ?? 'openai']
}
