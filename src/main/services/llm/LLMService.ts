/**
 * LLM service entry point.
 */

import { BrowserWindow } from 'electron'
import { StreamingService } from './services/StreamingService'
import { SyncService } from './services/SyncService'
import { StructuredService } from './services/StructuredService'
import { EmbeddingService } from './services/EmbeddingService'
import type { LLMConfig, LLMMessage, ToolDefinition } from '@shared/types'
import type {
  LLMResponse,
  CodeAnalysis,
  Refactoring,
  CodeFix,
  TestCase,
} from './types'

/**
 * 清除 ANSI 颜色控制字符以及除了换行、回车、制表符之外的非法控制字符
 */
function cleanSpecialCharacters(text: string): string {
  if (typeof text !== 'string') return text
  // 1. 过滤 ANSI 颜色和控制码
  // eslint-disable-next-line no-control-regex -- Intentionally match protocol/control bytes for terminal handling or input sanitization.
  let cleaned = text.replace(/[\u001b\x1B]\[[0-9;]*[a-zA-Z]/g, '')
  // 2. 过滤除 \n, \r, \t 之外的所有 ASCII 控制字符
  // eslint-disable-next-line no-control-regex -- Intentionally match protocol/control bytes for terminal handling or input sanitization.
  cleaned = cleaned.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
  return cleaned
}

/**
 * 清洗消息的内容，支持多模态（数组）与纯文本格式
 */
function sanitizeMessageContent(content: any): any {
  if (typeof content === 'string') {
    return cleanSpecialCharacters(content)
  }
  if (Array.isArray(content)) {
    return content.map(item => {
      if (item && typeof item === 'object') {
        if (item.type === 'text' && typeof item.text === 'string') {
          return { ...item, text: cleanSpecialCharacters(item.text) }
        }
      }
      return item
    })
  }
  return content
}

/**
 * 统一清洗 LLM 请求参数中的消息和系统提示词
 */
function sanitizeLLMParams<T extends { messages?: any[]; systemPrompt?: string }>(params: T): T {
  const sanitized = { ...params }
  if (sanitized.messages) {
    sanitized.messages = sanitized.messages.map(msg => ({
      ...msg,
      content: sanitizeMessageContent(msg.content)
    }))
  }
  if (sanitized.systemPrompt) {
    sanitized.systemPrompt = cleanSpecialCharacters(sanitized.systemPrompt)
  }
  return sanitized
}

export class LLMService {
  private streamingService: StreamingService
  private syncService: SyncService
  private structuredService: StructuredService
  private embeddingService: EmbeddingService
  private abortControllers = new Map<string, AbortController>()

  constructor(window: BrowserWindow) {
    this.streamingService = new StreamingService(window)
    this.syncService = new SyncService()
    this.structuredService = new StructuredService()
    this.embeddingService = new EmbeddingService()
  }

  async sendMessage(params: {
    config: LLMConfig
    messages: LLMMessage[]
    tools?: ToolDefinition[]
    systemPrompt?: string
    activeTools?: string[]
    requestId?: string
  }) {
    const cleanedParams = sanitizeLLMParams(params)
    const requestId = cleanedParams.requestId || crypto.randomUUID()
    const abortController = new AbortController()
    this.abortControllers.set(requestId, abortController)

    try {
      return await this.streamingService.generate({
        ...cleanedParams,
        requestId,
        abortSignal: abortController.signal,
      })
    } finally {
      this.abortControllers.delete(requestId)
    }
  }

  abort(requestId?: string) {
    if (requestId) {
      const controller = this.abortControllers.get(requestId)
      if (controller) {
        controller.abort()
        this.abortControllers.delete(requestId)
      }
      return
    }

    for (const controller of this.abortControllers.values()) {
      controller.abort()
    }
    this.abortControllers.clear()
  }

  async sendMessageSync(params: {
    config: LLMConfig
    messages: LLMMessage[]
    tools?: ToolDefinition[]
    systemPrompt?: string
  }): Promise<LLMResponse<string>> {
    const cleanedParams = sanitizeLLMParams(params)
    return await this.syncService.generate(cleanedParams)
  }

  async analyzeCode(params: {
    config: LLMConfig
    code: string
    language: string
    filePath: string
  }): Promise<LLMResponse<CodeAnalysis>> {
    return await this.structuredService.analyzeCode(params)
  }

  async suggestRefactoring(params: {
    config: LLMConfig
    code: string
    language: string
    intent: string
  }): Promise<LLMResponse<Refactoring>> {
    return await this.structuredService.suggestRefactoring(params)
  }

  async suggestFixes(params: {
    config: LLMConfig
    code: string
    language: string
    diagnostics: Array<{
      message: string
      line: number
      column: number
      severity: number
    }>
  }): Promise<LLMResponse<CodeFix>> {
    return await this.structuredService.suggestFixes(params)
  }

  async generateTests(params: {
    config: LLMConfig
    code: string
    language: string
    framework?: string
  }): Promise<LLMResponse<TestCase>> {
    return await this.structuredService.generateTests(params)
  }

  async analyzeCodeStream(
    params: {
      config: LLMConfig
      code: string
      language: string
      filePath: string
    },
    onPartial: (partial: Partial<CodeAnalysis>) => void
  ): Promise<LLMResponse<CodeAnalysis>> {
    return await this.structuredService.analyzeCodeStream(params, onPartial)
  }

  async generateStructuredObject<T>(params: {
    config: LLMConfig
    schema: any
    system: string
    prompt: string
  }): Promise<LLMResponse<T>> {
    return await this.structuredService.generateStructuredObject(params)
  }

  async embedText(text: string, config: LLMConfig): Promise<LLMResponse<number[]>> {
    return await this.embeddingService.embedText(text, config)
  }

  async embedMany(texts: string[], config: LLMConfig): Promise<LLMResponse<number[][]>> {
    return await this.embeddingService.embedMany(texts, config)
  }

  async findSimilar(
    query: string,
    candidates: string[],
    config: LLMConfig,
    topK?: number
  ) {
    return await this.embeddingService.findMostSimilar(query, candidates, config, topK)
  }

  destroy() {
    this.abort()
  }
}

export type { CodeAnalysis, Refactoring, CodeFix, TestCase, LLMResponse }
export { LLMError } from './types'
