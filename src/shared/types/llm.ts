/**
 * Shared LLM-related types.
 * This file is the single export point for LLM payloads, tool schemas, and tool UI state.
 */

// ============================================
// Message content
// ============================================

export interface TextContent {
    type: 'text'
    text: string
}

export interface ImageContent {
    type: 'image'
    source: {
        type: 'base64' | 'url'
        media_type?: string
        data: string
    }
}

export type MessageContentPart = TextContent | ImageContent
export type MessageContent = string | MessageContentPart[]

// ============================================
// LLM messages
// ============================================

export interface LLMMessage {
    role: 'user' | 'assistant' | 'system' | 'tool'
    /** Assistant messages with tool calls may use `null` content. */
    content: MessageContent | null
    /** OpenAI-style tool calls. */
    tool_calls?: LLMToolCallMessage[]
    /** Tool-call id for tool role messages. */
    tool_call_id?: string
    /** Tool name for tool role messages. */
    name?: string
    /** Reasoning text for providers that expose it. */
    reasoning_content?: string
    /** Anthropic thinking block signature for replay. */
    reasoning_signature?: string
}

export interface LLMToolCallMessage {
    id: string
    type: 'function'
    function: {
        name: string
        arguments: string
    }
}

// ============================================
// Provider config
// ============================================

export type ProviderType =
    | 'openai'
    | 'anthropic'
    | 'gemini'
    | 'deepseek'
    | 'groq'
    | 'mistral'
    | 'ollama'
    | 'custom'

export type OpenAICompatibilityProfile = import('@shared/config/providers').OpenAICompatibilityProfile

export interface LLMProviderOptions {
    /**
     * Canonical OpenAI-style provider options.
     * Applies to builtin OpenAI, OpenAI Responses, and OpenAI-compatible routes.
     */
    openai?: Record<string, unknown>
    /** Canonical Anthropic provider options. */
    anthropic?: Record<string, unknown>
    /** Canonical Google provider options. */
    google?: Record<string, unknown>
}

export interface LLMCapabilities {
    /**
     * Whether the route should be treated as an OpenAI-style reasoning route
     * that restricts standard sampling params unless explicitly disabled.
     */
    openAIReasoningModel?: boolean
    /**
     * Whether OpenAI-style reasoning routes allow temperature/topP when
     * reasoning is explicitly disabled.
     */
    openAIReasoningSupportsSampling?: boolean
    /**
     * Whether an OpenAI-compatible gateway accepts newer reasoning effort
     * tiers such as `xhigh` and `max` instead of the conservative subset.
     */
    openAICompatibleSupportsExtendedReasoningEffort?: boolean
    /**
     * Whether this route supports OpenAI prompt cache retention hints.
     */
    openAIPromptCacheRetention?: boolean
    /**
     * Whether an OpenAI Responses-compatible upstream accepts the official
     * `max_output_tokens` request field.
     */
    openAIResponsesSupportsMaxOutputTokens?: boolean
    /**
     * Google thinking config mode expected by the upstream route.
     */
    googleThinkingMode?: 'budget' | 'level'
    /**
     * Extra thinking tag parsing mode for providers that stream reasoning
     * inside textual wrappers instead of native reasoning events.
     */
    thinkingTagFormat?: 'native' | 'xml-think'
    /**
     * Whether to run the pseudo tool-call compatibility adapter, which turns
     * tool calls streamed as plain text (`[{"name":...,"parameters":{...}}]` or
     * `<tool_call>{...}</tool_call>`) into standard tool-call events.
     *
     * Defaults to enabled whenever the request carries tools — that is the
     * historical behaviour, and it also probes routes whose native tool calls
     * work fine. Set to `false` on those routes to skip the probe entirely.
     */
    pseudoToolCallFallback?: boolean
}

export interface LLMConfig {
    provider: string
    model: string
    apiKey: string
    baseUrl?: string
    timeout?: number

    // Core generation params.
    maxTokens?: number
    temperature?: number
    topP?: number
    frequencyPenalty?: number
    presencePenalty?: number
    stopSequences?: string[]
    topK?: number
    seed?: number
    logitBias?: Record<string, number>

    // Extended AI SDK params.
    maxRetries?: number
    toolChoice?: 'auto' | 'none' | 'required' | { type: 'tool'; toolName: string }
    parallelToolCalls?: boolean
    headers?: Record<string, string>

    /** Provider protocol selection for AI SDK adapters. */
    protocol?: import('@shared/config/providers').ApiProtocol
    /** Capability profile for OpenAI-style custom endpoints. */
    openAICompatibilityProfile?: OpenAICompatibilityProfile
    /** Enables reasoning / thinking mode where supported. */
    enableThinking?: boolean
    /** Thinking token budget for providers that support it. */
    thinkingBudget?: number
    /** Reasoning effort level for providers that support it. */
    reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    /** Explicit route capability overrides; preferred over model-name heuristics. */
    capabilities?: LLMCapabilities
    /**
     * Advanced protocol-specific AI SDK provider options.
     * Uses canonical protocol keys instead of transport-specific aliases.
     */
    providerOptions?: LLMProviderOptions
}

export interface LLMParameters {
    temperature: number
    topP: number
    maxTokens: number
    frequencyPenalty?: number
    presencePenalty?: number
    topK?: number
    seed?: number
    logitBias?: Record<string, number>
}

// ============================================
// LLM responses
// ============================================

/** Raw tool call returned by the model before execution state is added. */
export interface LLMToolCall {
    id: string
    name: string
    arguments: Record<string, unknown>
}

export interface LLMStreamSource {
    id: string
    sourceType: 'url' | 'document'
    url?: string
    title?: string
    mediaType?: string
    filename?: string
}

export interface LLMResponseMetadata {
    id: string
    modelId: string
    timestamp: Date
    finishReason?: string
}

/**
 * 渲染端在 `llm:stream:${requestId}` 频道上实际看到的一条事件。
 *
 * 这是这条线协议的**唯一**声明。以前同一个形状被写了四遍（主进程 StreamEvent
 * 用 kebab-case、preload 一份、这里一份、stream.ts 内联一份），而这一份还是错的：
 * 带一个无人读写的 `toolCallDelta`，却缺了真正在线上传的 `id`/`name`/`arguments`。
 * 于是「改一个字段名」不会有任何地方报错，只会在运行时静默丢事件。
 *
 * 改成判别联合而不是宽松的可选字段包，是为了让 `switch (chunk.type)` 能被编译器
 * 窄化——少写一个 case 或多读一个字段都会变成编译错误。
 *
 * 注意这里**不含** error 与 done：它们走各自的 `llm:error:*` / `llm:done:*` 频道，
 * 载荷形状也不同。旧类型把 `'error'` 列在这里，而渲染端 switch 从来没有对应的
 * case，属于纯误导。
 *
 * 形状由 tests/main/streamingServiceGolden.test.ts 逐字段钉住。
 */
export type RendererStreamChunk =
    | { type: 'text'; content: string }
    | { type: 'reasoning'; content: string }
    | { type: 'tool_call_start'; id: string; name: string }
    | { type: 'tool_call_delta'; id: string; name?: string; argumentsDelta: string }
    | { type: 'tool_call_delta_end'; id: string }
    | { type: 'tool_call_available'; id: string; name: string; arguments: Record<string, unknown> }
    | { type: 'source'; source: LLMStreamSource }

export type RendererStreamChunkType = RendererStreamChunk['type']

/** `llm:error:${requestId}` 的载荷（见 StreamingService.sendEventImmediate） */
export interface RendererStreamError {
    message: string
    code: string
    retryable: boolean
}

/** `llm:done:${requestId}` 的载荷（见 StreamingService.sendEventImmediate） */
export interface RendererStreamDone {
    reasoning?: string
    reasoningSignature?: string
    usage?: LLMResult['usage']
    metadata?: LLMResponseMetadata
}

export interface LLMResult {
    content: string
    reasoning?: string
    /** 部分 provider（Anthropic）要求把推理签名原样回传，否则下一轮会被拒 */
    reasoningSignature?: string
    toolCalls?: LLMToolCall[]
    usage?: {
        promptTokens: number
        completionTokens: number
        totalTokens: number
        cachedInputTokens?: number
        cacheWriteTokens?: number
        reasoningTokens?: number
        cacheReadSource?: 'provider-reported' | 'derived'
        cacheWriteSource?: 'provider-reported' | 'estimated'
    }
    metadata?: LLMResponseMetadata
}

// ============================================
// Errors
// ============================================

export interface LLMError {
    message: string
    code: string
    retryable: boolean
}

export enum LLMErrorCode {
    NETWORK_ERROR = 'NETWORK_ERROR',
    TIMEOUT = 'TIMEOUT',
    INVALID_API_KEY = 'INVALID_API_KEY',
    RATE_LIMIT = 'RATE_LIMIT',
    QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
    MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
    CONTEXT_LENGTH_EXCEEDED = 'CONTEXT_LENGTH_EXCEEDED',
    INVALID_REQUEST = 'INVALID_REQUEST',
    ABORTED = 'ABORTED',
    UNKNOWN = 'UNKNOWN',
}

// ============================================
// IPC payloads
// ============================================

export interface LLMSendMessageParams {
    config: LLMConfig
    messages: LLMMessage[]
    tools?: ToolDefinition[]
    systemPrompt?: string
    activeTools?: string[]
    /** IPC 频道隔离的依据，整套 per-request 通道都靠它；实际调用一直在传 */
    requestId?: string
}

// ============================================
// Tool definitions
// ============================================

export interface ToolDefinition {
    name: string
    description: string
    approvalType?: ToolApprovalType
    parameters: {
        type: 'object'
        properties: Record<string, ToolPropertySchema>
        required?: string[]
    }
}

export interface ToolPropertySchema {
    type: string
    description?: string
    enum?: string[]
    items?: ToolPropertySchema
    properties?: Record<string, ToolPropertySchema>
    required?: string[]
}

// ============================================
// Tool execution / UI state
// ============================================

export type ToolStatus = 'pending' | 'awaiting' | 'running' | 'success' | 'error' | 'rejected'
export type ToolApprovalType = 'none' | 'terminal' | 'dangerous' | 'interaction'
export type ToolResultType = 'tool_request' | 'running_now' | 'success' | 'tool_error' | 'rejected'
export type ToolConcurrencyMode = 'parallel-safe' | 'serialized' | 'approval-gated'
export type ToolResultSemantics = 'text' | 'file-read' | 'file-write' | 'command' | 'interactive' | 'plan' | 'search' | 'network'
export type ToolValidationLevel = 'schema' | 'semantic' | 'strict'

export interface ToolRetryPolicy {
    maxAttempts: number
    retryableErrors?: string[]
}

export interface ToolExecutionOutcome {
    kind: 'success' | 'error' | 'skipped' | 'conflict' | 'awaiting_user'
    code?: string
    retryable?: boolean
}

export interface ToolExecutionEnvelope {
    executionId: string
    providerId?: string
    startedAt: number
    completedAt?: number
    retryable?: boolean
    errorCategory?: 'validation' | 'execution' | 'timeout' | 'conflict' | 'approval' | 'dependency'
}

/**
 * Ephemeral tool preview state used while a tool call is still streaming.
 * The canonical live source now lives on the thread store.
 */
export interface ToolStreamingPreview {
    isStreaming: boolean
    name?: string
    partialArgs?: Record<string, unknown>
    lastUpdateTime?: number
}

/** Tool call record rendered in the chat UI. */
export interface ToolCall {
    id: string
    name: string
    arguments: Record<string, unknown>
    status: ToolStatus
    result?: string
    error?: string
    /** Structured rich results such as images, code, tables, or files. */
    richContent?: ToolRichContent[]
    /**
     * Legacy compatibility field.
     * Live streaming previews should read from thread-level `ToolStreamingPreview` state instead.
     */
    streamingState?: ToolStreamingPreview
}

export interface ToolExecutionResult {
    success: boolean
    /** Plain-text result returned to the model. */
    result: string
    error?: string
    /** Extra execution metadata for UI and follow-up logic. */
    meta?: Record<string, unknown>
    /** Structured rich output for renderer-side display. */
    richContent?: ToolRichContent[]
    outcome?: ToolExecutionOutcome
    envelope?: ToolExecutionEnvelope
}

export type ToolRichContentType =
    | 'asset-job'
    | 'text'
    | 'image'
    | 'code'
    | 'json'
    | 'markdown'
    | 'html'
    | 'file'
    | 'link'
    | 'table'

export interface ToolRichContent {
    jobId?: string
    type: ToolRichContentType
    text?: string
    data?: string
    mimeType?: string
    uri?: string
    title?: string
    language?: string
    tableData?: {
        headers: string[]
        rows: string[][]
    }
    url?: string
}

export interface ToolExecutionContext {
    abortSignal?: AbortSignal
    /** Update the existing tool presentation without producing another model tool call. */
    onProgress?: (update: Pick<ToolExecutionResult, 'meta' | 'richContent'>) => void
    isSubAgent?: boolean
    planPhase?: 'planning' | 'executing'
    workspacePath: string | null
    currentAssistantId?: string | null
    chatMode?: import('@/renderer/modes/types').WorkMode
    toolCallId?: string
    threadId?: string | null
    requestId?: string
    assistantId?: string | null
    checkpointId?: string
    securityApproval?: import('@shared/security/executionPolicy').AgentApprovalProof
}

export type ToolExecutor = (
    args: Record<string, unknown>,
    context: ToolExecutionContext
) => Promise<ToolExecutionResult>

export interface ValidationResult<T = unknown> {
    success: boolean
    data?: T
    error?: string
}

/** AST node used by code graph / call graph analysis. */
export interface CodeGraphNode {
    id: string
    name: string
    type: 'definition' | 'call'
    content: string
    startLine: number
    endLine: number
    callerName?: string
    calleeName?: string
}
