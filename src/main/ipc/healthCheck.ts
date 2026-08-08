/**
 * Health Check IPC Handlers
 * 在主进程中执行网络请求以避免 CORS 问题
 */

import { logger } from '@shared/utils/Logger'
import { toAppError } from '@shared/utils/errorHandler'
import { BUILTIN_PROVIDERS, getBuiltinProvider, isBuiltinProvider } from '@shared/config/providers'
import type { LLMConfig } from '@shared/types/llm'
import { createModel, resolveAuthForConfig, resolveHeaderPlaceholders } from '../services/llm/modelFactory'
import { OpenAIAuthService } from '../services/openai/OpenAIAuthService'
import { OpenAIUsageStore } from '../services/openai/OpenAIUsageStore'
import { generateText } from 'ai'
import { safeIpcHandle } from './safeHandle'

export interface HealthCheckResult {
  provider: string
  status: 'healthy' | 'unhealthy' | 'unknown'
  latency?: number
  error?: string
  checkedAt: Date
}

export interface ModelTestResult {
  success: boolean
  content?: string
  latency?: number
  error?: string
}

function normalizeResponsesBaseUrl(baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined
  const trimmed = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  return /\/v\d+(?:beta)?$/i.test(trimmed) ? trimmed : `${trimmed}/v1`
}

function extractResponsesOutputText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''

  const maybePayload = payload as {
    output_text?: unknown
    output?: Array<{
      type?: string
      content?: Array<{
        type?: string
        text?: string
      }>
    }>
  }

  if (typeof maybePayload.output_text === 'string' && maybePayload.output_text.trim()) {
    return maybePayload.output_text.trim()
  }

  const parts: string[] = []
  for (const item of maybePayload.output || []) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue
    for (const content of item.content) {
      if (content?.type === 'output_text' && typeof content.text === 'string' && content.text.trim()) {
        parts.push(content.text.trim())
      }
    }
  }

  return parts.join('\n').trim()
}

/**
 * Collect text from a Responses API SSE stream.
 *
 * The ChatGPT backend only speaks streaming, so the test request gets back a
 * `text/event-stream` of `response.*` events rather than a single JSON body.
 * Deltas are accumulated; the terminal `response.completed` event carries the
 * full response object, which is preferred when present.
 */
function extractResponsesOutputTextFromSSE(raw: string): string {
  const deltas: string[] = []
  let terminal = ''

  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') continue

    let event: { type?: string; delta?: unknown; response?: unknown }
    try {
      event = JSON.parse(data)
    } catch {
      continue
    }

    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      deltas.push(event.delta)
      continue
    }
    if (
      (event.type === 'response.completed' || event.type === 'response.incomplete') &&
      event.response
    ) {
      terminal = extractResponsesOutputText(event.response)
      continue
    }
    if (event.type === 'response.failed' || event.type === 'error') {
      const message =
        (event.response as { error?: { message?: string } } | undefined)?.error?.message
        ?? (event as { message?: string }).message
      throw new Error(message || 'Model stream failed')
    }
  }

  return (terminal || deltas.join('')).trim()
}

async function testOpenAIResponsesModel(config: LLMConfig): Promise<string> {
  const builtinProvider = isBuiltinProvider(config.provider)
    ? BUILTIN_PROVIDERS[config.provider]
    : undefined
  // The ChatGPT backend path is exact — appending /v1 gives a 404.
  const rawBaseUrl = config.baseUrl || builtinProvider?.baseUrl
  const baseUrl = builtinProvider?.auth.type === 'oauth'
    ? rawBaseUrl?.replace(/\/$/, '')
    : normalizeResponsesBaseUrl(rawBaseUrl)
  if (!baseUrl) {
    throw new Error('OpenAI Responses provider requires baseUrl')
  }

  const timeoutMs = typeof config.timeout === 'number' && config.timeout > 0
    ? config.timeout
    : 30000
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(resolveHeaderPlaceholders(config.headers, config.apiKey) || {}),
  }

  const hasAuthorizationHeader = Object.keys(headers).some(key => key.toLowerCase() === 'authorization')
  if (!hasAuthorizationHeader) {
    headers['Authorization'] = `Bearer ${config.apiKey || ''}`
  }

  try {
    const response = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        // The ChatGPT backend only accepts the structured array form of `input`;
        // a bare string is rejected with "Input must be a list".
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: 'hi,Please tell me directly what model you are?' },
            ],
          },
        ],
        // The ChatGPT backend rejects `max_output_tokens` outright.
        ...(builtinProvider?.auth.type !== 'oauth'
          && config.capabilities?.openAIResponsesSupportsMaxOutputTokens !== false
          ? { max_output_tokens: 10 }
          : {}),
        // The ChatGPT backend rejects server-side storage; api.openai.com accepts false too.
        ...(builtinProvider?.auth.type === 'oauth' ? { store: false } : {}),
        // Codex CLI never sends `text.format` to the ChatGPT backend — keep the
        // payload minimal there and only set it for standard Responses endpoints.
        ...(builtinProvider?.auth.type === 'oauth'
          ? {}
          : { text: { format: { type: 'text' } } }),
        // The ChatGPT backend refuses non-streaming requests outright
        // ("Stream must be set to true"), so this path must read SSE back.
        ...(builtinProvider?.auth.type === 'oauth' ? { stream: true } : {}),
      }),
    })

    const responseText = await response.text()
    // Snapshot subscription usage — these headers ride along on every
    // ChatGPT backend response, including failures.
    if (builtinProvider?.auth.type === 'oauth') {
      OpenAIUsageStore.captureFromHeaders(response.headers)
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseText}`)
    }

    // Streamed responses come back as SSE, not a single JSON object. Detect by
    // content type and fall back to the framing itself for lenient upstreams.
    const isEventStream =
      (response.headers.get('content-type') || '').includes('text/event-stream') ||
      responseText.startsWith('event:') ||
      responseText.startsWith('data:')

    if (isEventStream) {
      const streamedText = extractResponsesOutputTextFromSSE(responseText)
      if (!streamedText) {
        throw new Error('Model returned no text output')
      }
      return streamedText
    }

    let payload: unknown
    try {
      payload = JSON.parse(responseText)
    } catch {
      throw new Error(`Invalid JSON response: ${responseText}`)
    }

    const outputText = extractResponsesOutputText(payload)
    if (!outputText) {
      throw new Error('Model returned no text output')
    }

    return outputText
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 注册健康检查 IPC handlers
 */
export function registerHealthCheckHandlers() {
  safeIpcHandle('healthCheck:check', async (_, provider: string, apiKey: string, baseUrl?: string, timeout = 10000, protocol?: string) => {
    const startTime = Date.now()

    // OAuth providers carry no API key — resolve the access token from the auth store.
    let accountID: string | undefined
    if (getBuiltinProvider(provider)?.auth.type === 'oauth') {
      const token = await OpenAIAuthService.getValidToken()
      if (!token) {
        return {
          provider,
          status: 'unhealthy' as const,
          error: 'Not signed in to ChatGPT. Please sign in first.',
          checkedAt: new Date(),
        }
      }
      // The ChatGPT backend has no /models endpoint; a valid token is the health signal.
      return {
        provider,
        status: 'healthy' as const,
        latency: Date.now() - startTime,
        checkedAt: new Date(),
      }
    }

    const defaultUrls: Record<string, string> = {
      openai: 'https://api.openai.com/v1',
      'openai-oauth': 'https://chatgpt.com/backend-api/codex',
      anthropic: 'https://api.anthropic.com',
      gemini: 'https://generativelanguage.googleapis.com',
      deepseek: 'https://api.deepseek.com/v1',
      groq: 'https://api.groq.com/openai/v1',
      mistral: 'https://api.mistral.ai/v1',
      ollama: 'http://localhost:11434/v1',
      nvidia: 'https://integrate.api.nvidia.com/v1',
    }

    const url = (baseUrl || defaultUrls[provider] || defaultUrls.openai).replace(/\/$/, '')
    const activeProtocol = protocol || (provider === 'gemini' ? 'google' : provider === 'anthropic' ? 'anthropic' : 'openai')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      logger.ipc.info(`[HealthCheck] Checking ${provider} at ${url} (protocol: ${activeProtocol})`)

      let fetchUrl: string
      let headers: Record<string, string> = { 'Content-Type': 'application/json' }

      if (activeProtocol === 'google') {
        // Google Gemini: GET /v1beta/models?key=
        // 智能处理：如果 URL 已包含 /v1 或 /v1beta，直接追加 /models
        if (url.includes('/v1beta') || url.includes('/v1')) {
          fetchUrl = `${url}/models`
        } else {
          fetchUrl = `${url}/v1beta/models`
        }
        if (apiKey) fetchUrl += `?key=${apiKey}`
      } else if (activeProtocol === 'anthropic') {
        // Anthropic: GET /v1/models
        // 智能处理：如果 URL 已包含 /v1，直接追加 /models
        if (url.includes('/v1')) {
          fetchUrl = `${url}/models`
        } else {
          fetchUrl = `${url}/v1/models`
        }
        headers['x-api-key'] = apiKey
        headers['anthropic-version'] = '2023-06-01'
      } else {
        // OpenAI / OpenAI-Responses / 其他兼容协议: GET /models
        // 智能处理：如果 URL 已包含 /v1 或 /v4 等版本号，直接追加 /models
        if (/\/v\d+/.test(url)) {
          fetchUrl = `${url}/models`
        } else {
          fetchUrl = `${url}/v1/models`
        }
        headers['Authorization'] = `Bearer ${apiKey}`
        if (accountID) {
          headers['chatgpt-account-id'] = accountID
        }
      }

      const response = await fetch(fetchUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      })

      const latency = Date.now() - startTime

      if (response.ok) {
        logger.ipc.info(`[HealthCheck] ${provider} is healthy (${latency}ms)`)
        return { provider, status: 'healthy', latency, checkedAt: new Date() } as HealthCheckResult
      } else {
        logger.ipc.warn(`[HealthCheck] ${provider} returned HTTP ${response.status}`)
        return { provider, status: 'unhealthy', latency, error: `HTTP ${response.status}`, checkedAt: new Date() } as HealthCheckResult
      }
    } catch (err) {
      const error = toAppError(err)
      logger.ipc.error(`[HealthCheck] ${provider} check failed:`, error.message)
      return { provider, status: 'unhealthy', error: error.message || 'Connection failed', checkedAt: new Date() } as HealthCheckResult
    } finally {
      clearTimeout(timeoutId)
    }
  }, 'ipc')

  safeIpcHandle('healthCheck:testModel', async (_, config: LLMConfig) => {
    const startTime = Date.now()
    try {
      if (!config || !config.provider || !config.model) {
        throw new Error('Invalid model configuration: missing provider or model')
      }

      logger.ipc.info(`[ModelTest] Testing model ${config.model} for provider ${config.provider}`)
      logger.ipc.info(`[ModelTest] Config:`, {
        provider: config.provider,
        model: config.model,
        baseUrl: config.baseUrl,
        protocol: config.protocol,
        hasApiKey: !!config.apiKey
      })

      let text: string
      const resolvedConfig = await resolveAuthForConfig(config)
      if (resolvedConfig.protocol === 'openai-responses') {
        text = await testOpenAIResponsesModel(resolvedConfig)
      } else {
        const model = createModel(resolvedConfig)
        const result = await generateText({
          model,
          messages: [{ role: 'user', content: 'hi,Please tell me directly what model you are?' }],
          maxOutputTokens: 10,
        })
        text = result.text
      }

      const latency = Date.now() - startTime
      logger.ipc.info(`[ModelTest] Success: ${text.slice(0, 20)}... (${latency}ms)`)

      return {
        success: true,
        content: text,
        latency,
      }
    } catch (err) {
      const error = toAppError(err)
      const latency = Date.now() - startTime
      logger.ipc.error(`[ModelTest] Failed:`, error)
      logger.ipc.error(`[ModelTest] Error details:`, {
        message: error.message,
        stack: error.stack,
        cause: (err as any)?.cause,
        response: (err as any)?.response,
        data: (err as any)?.data
      })
      return {
        success: false,
        error: error.message || 'Model test failed',
        latency,
      }
    }
  }, 'ipc')

  safeIpcHandle('healthCheck:fetchModels', async (_, provider: string, apiKey: string, baseUrl?: string, protocol?: string) => {
    try {
      logger.ipc.info(`[HealthCheck] Fetching models for ${provider} (protocol: ${protocol})`)

      // OAuth providers carry no API key — resolve the access token from the auth store.
      let accountID: string | undefined
      if (getBuiltinProvider(provider)?.auth.type === 'oauth') {
        const token = await OpenAIAuthService.getValidToken()
        if (!token) {
          throw new Error('Not signed in to ChatGPT. Please sign in first.')
        }
        // The ChatGPT backend exposes no /models endpoint; the catalog is fixed.
        return { success: true, models: [...getBuiltinProvider(provider)!.models] }
      }

      const defaultUrls: Record<string, string> = {
        openai: 'https://api.openai.com/v1',
        'openai-oauth': 'https://chatgpt.com/backend-api/codex',
        anthropic: 'https://api.anthropic.com',
        gemini: 'https://generativelanguage.googleapis.com',
        deepseek: 'https://api.deepseek.com/v1',
        groq: 'https://api.groq.com/openai/v1',
        ollama: 'http://localhost:11434/v1',
      }

      let url = baseUrl || defaultUrls[provider] || defaultUrls.openai
      // 移除末尾斜杠
      url = url.endsWith('/') ? url.slice(0, -1) : url

      let fetchUrl = ''
      let headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      // 根据协议或提供商确定请求方式
      const activeProtocol = protocol || (provider === 'gemini' ? 'google' : provider === 'anthropic' ? 'anthropic' : 'openai')

      if (activeProtocol === 'google' || provider === 'gemini') {
        // Google Gemini API
        // 智能处理：如果 URL 已包含 /v1 或 /v1beta，直接追加 /models
        if (url.includes('/v1beta') || url.includes('/v1')) {
          fetchUrl = `${url}/models`
        } else {
          fetchUrl = `${url}/v1beta/models`
        }
        if (apiKey) {
          fetchUrl += `?key=${apiKey}`
        }
      } else if (activeProtocol === 'anthropic') {
        // Anthropic
        // 智能处理：如果 URL 已包含 /v1，直接追加 /models
        if (url.includes('/v1')) {
          fetchUrl = `${url}/models`
        } else {
          fetchUrl = `${url}/v1/models`
        }
        headers['x-api-key'] = apiKey
        headers['anthropic-version'] = '2023-06-01'
      } else {
        // OpenAI / OpenAI-Responses / 其他兼容协议
        // 智能处理：如果 URL 已包含 /v1 或 /v4 等版本号，直接追加 /models
        if (/\/v\d+/.test(url)) {
          fetchUrl = `${url}/models`
        } else {
          fetchUrl = `${url}/v1/models`
        }
        headers['Authorization'] = `Bearer ${apiKey}`
        if (accountID) {
          headers['chatgpt-account-id'] = accountID
        }
      }

      logger.ipc.info(`[HealthCheck] Requesting models from: ${fetchUrl}`)

      const response = await fetch(fetchUrl, {
        method: 'GET',
        headers,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`)
      }

      const data = await response.json() as unknown
      let models: string[] = []

      if (activeProtocol === 'google' || provider === 'gemini') {
        if (data && typeof data === 'object' && 'models' in data && Array.isArray(data.models)) {
          models = data.models.map((m: any) => m.name.replace('models/', ''))
        }
      } else {
        // OpenAI 格式
        if (data && typeof data === 'object' && 'data' in data && Array.isArray(data.data)) {
          models = data.data.map((m: any) => m.id)
        } else if (Array.isArray(data)) {
          // 某些非标准接口直接返回数组
          models = data.map((m: any) => typeof m === 'string' ? m : (m.id || m.name))
        }
      }

      // 过滤掉不合法的空值并排序
      models = models.filter(Boolean).sort()

      logger.ipc.info(`[HealthCheck] Successfully fetched ${models.length} models`)
      return { success: true, models }

    } catch (err) {
      const error = toAppError(err)
      logger.ipc.error(`[HealthCheck] Fetch models failed:`, error.message)
      return { success: false, error: error.message }
    }
  }, 'ipc')

  logger.ipc.info('[HealthCheck] Health check handlers registered')
}
