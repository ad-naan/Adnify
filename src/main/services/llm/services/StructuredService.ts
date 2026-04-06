/**
 * Structured-output service built on AI SDK generateText / generateObject.
 */

import { generateObject, generateText, Output } from 'ai'
import type { ModelMessage } from '@ai-sdk/provider-utils'
import { z } from 'zod'
import { logger } from '@shared/utils/Logger'
import { createModel } from '../modelFactory'
import { executePreparedRequest } from '../core/RequestExecution'
import { LLMError, convertUsage } from '../types'
import type { LLMResponse, CodeAnalysis, Refactoring, CodeFix, TestCase } from '../types'
import type { LLMConfig } from '@shared/types'

const CodeIssueSchema = z.object({
  severity: z.enum(['error', 'warning', 'info', 'hint']),
  message: z.string(),
  line: z.number(),
  column: z.number(),
  endLine: z.number().optional(),
  endColumn: z.number().optional(),
  code: z.string().optional(),
  source: z.string().optional(),
})

const CodeAnalysisSchema = z.object({
  issues: z.array(CodeIssueSchema),
  suggestions: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      priority: z.enum(['high', 'medium', 'low']),
      changes: z
        .array(
          z.object({
            line: z.number(),
            oldText: z.string(),
            newText: z.string(),
          })
        )
        .optional(),
    })
  ),
  summary: z.string(),
})

const RefactoringSchema = z.object({
  refactorings: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      confidence: z.enum(['high', 'medium', 'low']),
      changes: z.array(
        z.object({
          type: z.enum(['replace', 'insert', 'delete']),
          startLine: z.number(),
          startColumn: z.number(),
          endLine: z.number(),
          endColumn: z.number(),
          newText: z.string().optional(),
        })
      ),
      explanation: z.string(),
    })
  ),
})

const CodeFixSchema = z.object({
  fixes: z.array(
    z.object({
      diagnosticIndex: z.number(),
      title: z.string(),
      description: z.string(),
      changes: z.array(
        z.object({
          startLine: z.number(),
          startColumn: z.number(),
          endLine: z.number(),
          endColumn: z.number(),
          newText: z.string(),
        })
      ),
      confidence: z.enum(['high', 'medium', 'low']),
    })
  ),
})

const TestCaseSchema = z.object({
  testCases: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      code: z.string(),
      type: z.enum(['unit', 'integration', 'edge-case']),
    })
  ),
  setup: z.string().optional(),
  teardown: z.string().optional(),
})

interface GenerationResponseLike {
  usage?: Parameters<typeof convertUsage>[0]
  response: {
    id: string
    modelId: string
    timestamp: Date
  }
  finishReason?: string | null
}

export class StructuredService {
  private buildResponse<T>(result: GenerationResponseLike, data: T): LLMResponse<T> {
    return {
      data,
      usage: result.usage ? convertUsage(result.usage) : undefined,
      metadata: {
        id: result.response.id,
        modelId: result.response.modelId,
        timestamp: result.response.timestamp,
        finishReason: result.finishReason || undefined,
      },
    }
  }

  private async executeStructuredText<T>(options: {
    config: LLMConfig
    operation: string
    messages: ModelMessage[]
    schema: z.ZodTypeAny
    onData?: (data: T) => void
  }): Promise<LLMResponse<T>> {
    const { config, operation, messages, schema, onData } = options
    const model = createModel(config)

    const result = await executePreparedRequest({
      config,
      operation,
      baseMessages: messages,
      execute: async ({ messages: preparedMessages, providerOptions }) =>
        await generateText({
          model,
          messages: preparedMessages,
          providerOptions,
          experimental_output: Output.object({
            schema: schema as any,
          }),
        }),
    })

    const data = result.experimental_output as unknown as T
    onData?.(data)
    return this.buildResponse(result, data)
  }

  private async executeStructuredObjectRequest<T>(options: {
    config: LLMConfig
    operation: string
    messages: ModelMessage[]
    schema: z.ZodTypeAny
  }): Promise<LLMResponse<T>> {
    const { config, operation, messages, schema } = options
    const model = createModel(config)

    const result = await executePreparedRequest({
      config,
      operation,
      baseMessages: messages,
      execute: async ({ messages: preparedMessages, providerOptions }) =>
        await generateObject({
          model,
          schema: schema as any,
          messages: preparedMessages as any,
          providerOptions,
          temperature: config.temperature,
        }),
    })

    return this.buildResponse(result, result.object as T)
  }

  async analyzeCode(params: {
    config: LLMConfig
    code: string
    language: string
    filePath: string
  }): Promise<LLMResponse<CodeAnalysis>> {
    logger.system.info('[StructuredService] Analyzing code')

    try {
      return await this.executeStructuredText<CodeAnalysis>({
        config: params.config,
        operation: 'structured:analyze-code',
        messages: [
          {
            role: 'user',
            content: `Analyze the following ${params.language} code and return a structured analysis.

File: ${params.filePath}

\`\`\`${params.language}
${params.code}
\`\`\`

Return a JSON object with:
- issues: array of code issues (severity, message, line, column)
- suggestions: array of improvement suggestions (title, description, priority)
- summary: brief text summary`,
          },
        ],
        schema: CodeAnalysisSchema,
      })
    } catch (error) {
      const llmError = LLMError.fromError(error)
      logger.system.error('[StructuredService] Code analysis failed:', llmError)
      throw llmError
    }
  }

  async suggestRefactoring(params: {
    config: LLMConfig
    code: string
    language: string
    intent: string
  }): Promise<LLMResponse<Refactoring>> {
    logger.system.info('[StructuredService] Suggesting refactoring')

    try {
      return await this.executeStructuredText<Refactoring>({
        config: params.config,
        operation: 'structured:suggest-refactoring',
        messages: [
          {
            role: 'user',
            content: `Suggest refactorings for the following ${params.language} code.

Intent: ${params.intent}

\`\`\`${params.language}
${params.code}
\`\`\`

Return refactoring suggestions with precise line/column positions.`,
          },
        ],
        schema: RefactoringSchema,
      })
    } catch (error) {
      const llmError = LLMError.fromError(error)
      logger.system.error('[StructuredService] Refactoring failed:', llmError)
      throw llmError
    }
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
    logger.system.info('[StructuredService] Suggesting fixes')

    try {
      const diagnosticsText = params.diagnostics
        .map((diagnostic, index) => `${index}. Line ${diagnostic.line}: ${diagnostic.message}`)
        .join('\n')

      return await this.executeStructuredText<CodeFix>({
        config: params.config,
        operation: 'structured:suggest-fixes',
        messages: [
          {
            role: 'user',
            content: `Suggest fixes for the following ${params.language} errors:

Diagnostics:
${diagnosticsText}

Code:
\`\`\`${params.language}
${params.code}
\`\`\`

Return fix suggestions with precise line/column positions.`,
          },
        ],
        schema: CodeFixSchema,
      })
    } catch (error) {
      const llmError = LLMError.fromError(error)
      logger.system.error('[StructuredService] Fix suggestion failed:', llmError)
      throw llmError
    }
  }

  async generateTests(params: {
    config: LLMConfig
    code: string
    language: string
    framework?: string
  }): Promise<LLMResponse<TestCase>> {
    logger.system.info('[StructuredService] Generating tests')

    try {
      return await this.executeStructuredText<TestCase>({
        config: params.config,
        operation: 'structured:generate-tests',
        messages: [
          {
            role: 'user',
            content: `Generate test cases for the following ${params.language} code${params.framework ? ` using ${params.framework}` : ''}.

\`\`\`${params.language}
${params.code}
\`\`\`

Return comprehensive test cases including unit tests, integration tests, and edge cases.`,
          },
        ],
        schema: TestCaseSchema,
      })
    } catch (error) {
      const llmError = LLMError.fromError(error)
      logger.system.error('[StructuredService] Test generation failed:', llmError)
      throw llmError
    }
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
    logger.system.info('[StructuredService] Analyzing code (streaming)')

    try {
      return await this.executeStructuredText<CodeAnalysis>({
        config: params.config,
        operation: 'structured:analyze-code-stream',
        messages: [
          {
            role: 'user',
            content: `Analyze the following ${params.language} code:

File: ${params.filePath}

\`\`\`${params.language}
${params.code}
        \`\`\`

Return structured analysis with issues, suggestions, and summary.`,
          },
        ],
        schema: CodeAnalysisSchema,
        onData: onPartial,
      })
    } catch (error) {
      const llmError = LLMError.fromError(error)
      logger.system.error('[StructuredService] Streaming analysis failed:', llmError)
      throw llmError
    }
  }

  async generateStructuredObject<T>(params: {
    config: LLMConfig
    schema: any
    system: string
    prompt: string
  }): Promise<LLMResponse<T>> {
    logger.system.info('[StructuredService] Generating structured object')

    try {
      const zodSchema: z.ZodTypeAny = params.schema._def
        ? params.schema
        : jsonSchemaToZod(params.schema)

      return await this.executeStructuredObjectRequest<T>({
        config: params.config,
        operation: 'structured:generate-object',
        messages: [
          ...(params.system ? [{ role: 'system' as const, content: params.system }] : []),
          { role: 'user' as const, content: params.prompt },
        ],
        schema: zodSchema,
      })
    } catch (error) {
      const llmError = LLMError.fromError(error)
      logger.system.error('[StructuredService] Structured object generation failed:', llmError)
      throw llmError
    }
  }
}

function jsonSchemaToZod(schema: any): z.ZodTypeAny {
  if (schema.type === 'object') {
    const shape: Record<string, z.ZodTypeAny> = {}
    for (const [key, value] of Object.entries(schema.properties || {})) {
      const propSchema = value as any
      shape[key] = jsonSchemaToZod(propSchema)
      if (propSchema.description) {
        shape[key] = shape[key].describe(propSchema.description)
      }
    }
    return z.object(shape)
  }

  if (schema.type === 'array') {
    return z.array(jsonSchemaToZod(schema.items))
  }

  if (schema.type === 'string') {
    if (schema.enum) {
      return z.enum(schema.enum as [string, ...string[]])
    }
    return z.string()
  }

  if (schema.type === 'number') {
    return z.number()
  }

  if (schema.type === 'boolean') {
    return z.boolean()
  }

  return z.any()
}
