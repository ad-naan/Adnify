import { streamText } from 'ai'
import { logger } from '@shared/utils/Logger'
import { createModel, resolveAuthForConfig } from '../modelFactory'
import { MessageConverter } from '../core/MessageConverter'
import { ToolConverter } from '../core/ToolConverter'
import { executePreparedRequest } from '../core/RequestExecution'
import { LLMError, convertUsage } from '../types'
import type { LLMResponse } from '../types'
import type { LLMConfig, LLMMessage, ToolDefinition } from '@shared/types'
import type { ModelMessage } from '@ai-sdk/provider-utils'

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

  private stripSystemMessages(messages: ModelMessage[]): ModelMessage[] {
    return messages.filter(message => message.role !== 'system')
  }

  async generate(params: SyncParams): Promise<LLMResponse<string>> {
    const { config, messages, tools, systemPrompt, abortSignal, timeout } = params

    logger.system.info('[SyncService] Starting generation', {
      provider: config.provider,
      model: config.model,
      messageCount: messages.length,
    })

    try {
      const resolvedConfig = await resolveAuthForConfig(config)
      const model = createModel(resolvedConfig)
      const baseMessages = this.messageConverter.convert(messages, systemPrompt, resolvedConfig)
      const coreTools = tools ? this.toolConverter.convert(tools) : undefined

      const result = await executePreparedRequest({
        config: resolvedConfig,
        operation: 'sync',
        originalMessages: messages,
        baseMessages,
        systemPrompt,
        abortSignal,
        execute: async ({ messages: preparedMessages, settings, callOptions, providerOptions }) => {
          // `streamText`, not `generateText`: the ChatGPT OAuth backend rejects
          // non-streaming requests ("Stream must be set to true"). The stream is
          // consumed to completion here, so this stays a synchronous API.
          const stream = streamText({
            model,
            instructions: systemPrompt,
            messages: this.stripSystemMessages(preparedMessages),
            tools: coreTools,
            ...settings,
            ...callOptions,
            providerOptions,
            abortSignal,
            timeout: timeout ?? callOptions.timeout ?? 120_000,
          })

          // Surface provider failures here rather than as an unhandled rejection.
          const [text, usage, finishReason, response, warnings] = await Promise.all([
            stream.text,
            stream.usage,
            stream.finishReason,
            stream.response,
            stream.warnings,
          ])

          const finalStep = await stream.finalStep
          return { text, usage, finishReason, response, warnings, providerMetadata: finalStep.providerMetadata }
        },
      })

      if (result.warnings && result.warnings.length > 0) {
        logger.llm.warn('[SyncService] Provider warnings', {
          provider: config.provider,
          model: config.model,
          warnings: result.warnings,
        })
      }

      return {
        data: result.text,
        usage: result.usage ? convertUsage(result.usage, result.providerMetadata) : undefined,
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
