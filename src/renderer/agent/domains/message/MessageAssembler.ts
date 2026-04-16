/**
 * Message Domain - 消息领域
 *
 * 职责：
 * - 消息组装：将历史消息、上下文、用户输入组装成 LLM 消息
 * - 消息压缩：根据预算策略压缩消息
 * - 消息转换：转换为 LLM API 格式
 *
 * DDD 设计：
 * - MessageAssembler: 聚合根，协调消息构建流程
 * - MessageCompressor: 领域服务，执行压缩策略
 * - MessageConverter: 领域服务，格式转换
 */

import { logger } from '@utils/Logger'
import type { ChatMessage, MessageContent } from '../../types'
import type { LLMMessage } from '@/shared/types'
import type { CompressionLevel } from '../context/compressionShared'
import { prepareMessages, estimateMessagesTokens } from '../context/CompressionManager'
import { buildLLMApiMessages } from './MessageConverter'
import { countTokens } from '@shared/utils/tokenCounter'

// ===== Value Objects =====

/**
 * 消息组装结果（值对象）
 */
export interface MessageAssemblyResult {
  /** LLM 消息列表 */
  messages: LLMMessage[]
  /** 应用的压缩等级 */
  compressionLevel: CompressionLevel
  /** 估算的总 token 数 */
  estimatedTokens: number
  /** 压缩统计 */
  compressionStats: {
    truncatedToolCalls: number
    clearedToolResults: number
    removedMessages: number
  }
}

/**
 * 用户消息内容（值对象）
 */
export interface UserMessageContent {
  /** 原始消息 */
  raw: MessageContent
  /** 上下文内容 */
  context: string
  /** 组合后的内容 */
  combined: MessageContent
  /** Token 估算 */
  estimatedTokens: number
}

// ===== Message Compressor (领域服务) =====

/**
 * 消息压缩器
 *
 * 职责：根据压缩等级压缩消息历史
 */
export class MessageCompressor {
  /**
   * 压缩消息历史
   */
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
      `[MessageCompressor] Compressed to L${level}: ` +
      `removed=${result.removedMessages}, truncated=${result.truncatedToolCalls}, cleared=${result.clearedToolResults}`
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

  /**
   * 估算消息 token 数
   */
  estimateTokens(messages: ChatMessage[]): number {
    return estimateMessagesTokens(messages)
  }
}

// ===== Message Assembler (聚合根) =====

/**
 * 消息组装器
 *
 * 职责：
 * - 协调消息构建流程
 * - 组装用户消息（原始消息 + 上下文）
 * - 应用压缩策略
 * - 转换为 LLM API 格式
 */
export class MessageAssembler {
  private compressor: MessageCompressor

  constructor() {
    this.compressor = new MessageCompressor()
  }

  /**
   * 组装用户消息内容
   */
  assembleUserMessage(
    rawMessage: MessageContent,
    contextContent: string
  ): UserMessageContent {
    // 如果没有上下文，直接返回原始消息
    if (!contextContent) {
      const estimatedTokens = this.estimateMessageTokens(rawMessage)
      return {
        raw: rawMessage,
        context: '',
        combined: rawMessage,
        estimatedTokens,
      }
    }

    // 构建上下文部分
    const contextPart = {
      type: 'text' as const,
      text: `## Referenced Context\n${contextContent}\n\n## User Request\n`,
    }

    // 组合消息
    let combined: MessageContent
    if (typeof rawMessage === 'string') {
      combined = [contextPart, { type: 'text' as const, text: rawMessage }]
    } else {
      combined = [contextPart, ...rawMessage]
    }

    const estimatedTokens = this.estimateMessageTokens(combined)

    return {
      raw: rawMessage,
      context: contextContent,
      combined,
      estimatedTokens,
    }
  }

  /**
   * 组装完整的 LLM 消息列表
   *
   * @param messageHistory 历史消息
   * @param userMessage 用户消息内容
   * @param systemPrompt 系统提示词
   * @param compressionLevel 压缩等级
   * @param handoffContext 可选的 handoff 上下文
   */
  assemble(
    messageHistory: ChatMessage[],
    userMessage: UserMessageContent,
    systemPrompt: string,
    compressionLevel: CompressionLevel,
    handoffContext?: string
  ): MessageAssemblyResult {
    // 1. 注入 handoff 上下文到系统提示词
    const enhancedSystemPrompt = handoffContext
      ? `${systemPrompt}\n\n${handoffContext}`
      : systemPrompt

    // 2. 压缩历史消息
    const { messages: compressedMessages, stats } = this.compressor.compress(
      messageHistory,
      compressionLevel
    )

    // 3. 转换为 LLM API 格式（排除最后一条用户消息，因为会重新添加）
    const lastMsg = compressedMessages[compressedMessages.length - 1]
    const messagesToConvert = lastMsg?.role === 'user'
      ? compressedMessages.slice(0, -1)
      : compressedMessages

    const llmMessages = buildLLMApiMessages(messagesToConvert, enhancedSystemPrompt)

    // 4. 添加当前用户消息
    llmMessages.push({
      role: 'user',
      content: userMessage.combined,
    })

    // 5. 估算总 token 数
    const historyTokens = this.compressor.estimateTokens(compressedMessages)
    const systemPromptTokens = countTokens(enhancedSystemPrompt)
    const estimatedTokens = historyTokens + systemPromptTokens + userMessage.estimatedTokens

    logger.agent.info(
      `[MessageAssembler] Assembled ${llmMessages.length} messages, ` +
      `L${compressionLevel}, ~${estimatedTokens} tokens`
    )

    return {
      messages: llmMessages,
      compressionLevel,
      estimatedTokens,
      compressionStats: stats,
    }
  }

  /**
   * 估算消息内容的 token 数
   */
  private estimateMessageTokens(content: MessageContent): number {
    if (typeof content === 'string') {
      return countTokens(content)
    }

    let total = 0
    for (const part of content) {
      if (part.type === 'text' && part.text) {
        total += countTokens(part.text)
      } else if (part.type === 'image') {
        total += 1600 // 固定估算
      }
    }
    return total
  }
}
