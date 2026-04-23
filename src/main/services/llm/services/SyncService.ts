import { generateText } from 'ai'
import { logger } from '@shared/utils/Logger'
import { createModel } from '../modelFactory'
import { MessageConverter } from '../core/MessageConverter'
import { ToolConverter } from '../core/ToolConverter'
import { executePreparedRequest } from '../core/RequestExecution'
import { LLMError, convertUsage } from '../types'
import type { LLMResponse } from '../types'
import type { LLMConfig, LLMMessage, ToolDefinition } from '@shared/types'

export interface SyncParams {
  config: LLMConfig
  messages: LLMMessage[]
  tools?: ToolDefinition[]
  systemPrompt?: string
  abortSignal?: AbortSignal
  timeout?: number
}

export class SyncService {
  private messageConverter: MessageConverter
  private toolConverter: ToolConverter

  constructor() {
    this.messageConverter = new MessageConverter()
    this.toolConverter = new ToolConverter()
  }

  async generate(params: SyncParams): Promise<LLMResponse<string>> {
    const { config, messages, tools, systemPrompt, abortSignal, timeout = 120_000 } = params

    logger.system.info('[SyncService] Starting generation', {
      provider: config.provider,
      model: config.model,
      messageCount: messages.length,
    })

    try {
      const model = createModel(config)
      const baseMessages = this.messageConverter.convert(messages, systemPrompt)
      const coreTools = tools ? this.toolConverter.convert(tools) : undefined

      const result = await executePreparedRequest({
        config,
        operation: 'sync',
        originalMessages: messages,
        baseMessages,
        abortSignal,
        execute: async ({ messages: preparedMessages, providerOptions }) =>
          await generateText({
            model,
            messages: preparedMessages,
            tools: coreTools,
            maxOutputTokens: config.maxTokens || 1000,
            temperature: config.temperature ?? 0.3,
            topP: config.topP !== undefined && config.topP < 1 ? config.topP : undefined,
            topK: config.topK,
            seed: config.seed,
            providerOptions,
            abortSignal,
            timeout,
          }),
      })

      return {
        data: result.text,
        usage: result.usage ? convertUsage(result.usage) : undefined,
        metadata: {
          id: result.response.id,
          modelId: result.response.modelId,
          timestamp: result.response.timestamp,
          finishReason: result.finishReason,
        },
      }
    } catch (error) {
      const llmError = LLMError.fromError(error)
      logger.system.error('[SyncService] Generation failed:', llmError)
      throw llmError
    }
  }
}
