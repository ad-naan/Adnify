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
    const requestId = params.requestId || crypto.randomUUID()
    const abortController = new AbortController()
    this.abortControllers.set(requestId, abortController)

    try {
      return await this.streamingService.generate({
        ...params,
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
    return await this.syncService.generate(params)
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
