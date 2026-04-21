/**
 * Message assembly for LLM requests.
 */

import { logger } from '@utils/Logger'
import type { ChatMessage, MessageContent, TodoItem } from '../../types'
import type { LLMMessage } from '@/shared/types'
import type { CompressionLevel } from '../context/compressionShared'
import { prepareMessages, estimateMessagesTokens } from '../context/CompressionManager'
import { buildLLMApiMessages } from './MessageConverter'
import { countTokens } from '@shared/utils/tokenCounter'

export interface RuntimeStateContext {
  handoffContext?: string
  todos?: TodoItem[]
  pendingObjective?: string
  pendingSteps?: string[]
}

export interface MessageAssemblyResult {
  messages: LLMMessage[]
  compressionLevel: CompressionLevel
  estimatedTokens: number
  compressionStats: {
    truncatedToolCalls: number
    clearedToolResults: number
    removedMessages: number
  }
}

export interface UserMessageContent {
  raw: MessageContent
  context: string
  combined: MessageContent
  estimatedTokens: number
}

export class MessageCompressor {
  compress(
    messages: ChatMessage[],
    level: CompressionLevel
  ): {
    messages: ChatMessage[]
    stats: {
      truncatedToolCalls: number
      clearedToolResults: number
      removedMessages: number
    }
  } {
    const result = prepareMessages(messages, level)

    logger.agent.debug(
      `[MessageCompressor] Compressed to L${level}: removed=${result.removedMessages}, truncated=${result.truncatedToolCalls}, cleared=${result.clearedToolResults}`
    )

    return {
      messages: result.messages,
      stats: {
        truncatedToolCalls: result.truncatedToolCalls,
        clearedToolResults: result.clearedToolResults,
        removedMessages: result.removedMessages,
      },
    }
  }

  estimateTokens(messages: ChatMessage[]): number {
    return estimateMessagesTokens(messages)
  }
}

export class MessageAssembler {
  private compressor: MessageCompressor

  constructor() {
    this.compressor = new MessageCompressor()
  }

  assembleUserMessage(
    rawMessage: MessageContent,
    contextContent: string
  ): UserMessageContent {
    if (!contextContent) {
      const estimatedTokens = this.estimateMessageTokens(rawMessage)
      return {
        raw: rawMessage,
        context: '',
        combined: rawMessage,
        estimatedTokens,
      }
    }

    const contextPart = {
      type: 'text' as const,
      text: `## Referenced Context\n${contextContent}\n\n## User Request\n`,
    }

    const combined: MessageContent = typeof rawMessage === 'string'
      ? [contextPart, { type: 'text' as const, text: rawMessage }]
      : [contextPart, ...rawMessage]

    return {
      raw: rawMessage,
      context: contextContent,
      combined,
      estimatedTokens: this.estimateMessageTokens(combined),
    }
  }

  assemble(
    messageHistory: ChatMessage[],
    userMessage: UserMessageContent,
    systemPrompt: string,
    compressionLevel: CompressionLevel,
    runtimeState?: RuntimeStateContext
  ): MessageAssemblyResult {
    const { messages: compressedMessages, stats } = this.compressor.compress(
      messageHistory,
      compressionLevel
    )

    const lastMsg = compressedMessages[compressedMessages.length - 1]
    const messagesToConvert = lastMsg?.role === 'user'
      ? compressedMessages.slice(0, -1)
      : compressedMessages

    const llmMessages = buildLLMApiMessages(messagesToConvert, systemPrompt)
    const runtimeStateMessage = this.buildRuntimeStateMessage(runtimeState)
    if (runtimeStateMessage) {
      llmMessages.push(runtimeStateMessage)
    }

    llmMessages.push({
      role: 'user',
      content: userMessage.combined,
    })

    const historyTokens = this.compressor.estimateTokens(compressedMessages)
    const systemPromptTokens = countTokens(systemPrompt)
    const runtimeTokens = runtimeStateMessage ? countTokens(String(runtimeStateMessage.content || '')) : 0
    const estimatedTokens = historyTokens + systemPromptTokens + runtimeTokens + userMessage.estimatedTokens

    logger.agent.info(
      `[MessageAssembler] Assembled ${llmMessages.length} messages, L${compressionLevel}, ~${estimatedTokens} tokens`
    )

    return {
      messages: llmMessages,
      compressionLevel,
      estimatedTokens,
      compressionStats: stats,
    }
  }

  private buildRuntimeStateMessage(runtimeState?: RuntimeStateContext): LLMMessage | null {
    if (!runtimeState) return null

    const sections: string[] = []

    if (runtimeState.handoffContext?.trim()) {
      sections.push(runtimeState.handoffContext.trim())
    }

    if (runtimeState.pendingObjective || (runtimeState.pendingSteps && runtimeState.pendingSteps.length > 0)) {
      const objective = runtimeState.pendingObjective?.trim() || 'None'
      const steps = runtimeState.pendingSteps?.slice(0, 8).map(step => `- ${step}`).join('\n') || '- None'
      sections.push(`## Runtime Task State\n\n**Pending Objective**: ${objective}\n\n**Pending Steps**:\n${steps}`)
    }

    if (runtimeState.todos && runtimeState.todos.length > 0) {
      const todoLines = runtimeState.todos
        .slice(0, 12)
        .map(todo => `- [${todo.status}] ${todo.status === 'in_progress' ? todo.activeForm : todo.content}`)
        .join('\n')
      sections.push(`## Runtime Task List\n\nThis is application state, not a fresh user request.\n${todoLines}`)
    }

    if (sections.length === 0) {
      return null
    }

    return {
      role: 'assistant',
      content: `Application runtime state snapshot.\nTreat this as resume context only.\n\n${sections.join('\n\n')}`,
    }
  }

  private estimateMessageTokens(content: MessageContent): number {
    if (typeof content === 'string') {
      return countTokens(content)
    }

    let total = 0
    for (const part of content) {
      if (part.type === 'text' && part.text) {
        total += countTokens(part.text)
      } else if (part.type === 'image') {
        total += 1600
      }
    }
    return total
  }
}
