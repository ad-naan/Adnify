import { api } from '@/renderer/services/electronAPI'
import type { LLMConfig, LLMMessage, MessageContentPart } from '@/shared/types/llm'

const MULTIMODAL_PREPASS_SYSTEM_PROMPT = `You are a visual analysis preprocessor for a coding assistant.

Analyze the user-provided image content and return a compact report using exactly these Markdown headings:

### Image Overview
### OCR / Visible Text
### Key Details
### Relevant Observations

Rules:
- Do not answer the user's request directly.
- Do not call tools.
- Focus only on information that could help a downstream language model complete the user's request.
- If a section has no useful information, write "None".
- Keep the report concise and factual.`

export interface MultimodalPrepassResult {
  summary: string
}

function normalizeVisualSummary(summary: string): string {
  const trimmed = summary.trim()
  if (!trimmed) {
    return ''
  }

  if (/^###\s+/m.test(trimmed)) {
    return trimmed
  }

  return [
    '### Image Overview',
    'None',
    '',
    '### OCR / Visible Text',
    'None',
    '',
    '### Key Details',
    trimmed,
    '',
    '### Relevant Observations',
    'None',
  ].join('\n')
}

export async function runMultimodalPrepass(params: {
  config: LLMConfig
  userMessage: LLMMessage
  requestId: string
}): Promise<MultimodalPrepassResult> {
  const response = await api.llm.compactContext({
    config: params.config,
    messages: [params.userMessage],
    systemPrompt: MULTIMODAL_PREPASS_SYSTEM_PROMPT,
    requestId: params.requestId,
  })

  if (response.error) {
    throw new Error(response.error)
  }

  const normalizedSummary = normalizeVisualSummary(response.content || '')
  if (!normalizedSummary) {
    throw new Error('Multimodal prepass returned empty content')
  }

  return { summary: normalizedSummary }
}

export function buildVisualAnalysisPrefix(summary: string): string {
  return `## Visual Analysis Summary\n${summary.trim()}\n\n## Original User Request\n`
}

function findLatestUserMessageIndex(messages: LLMMessage[]): number {
  return [...messages].map(message => message.role).lastIndexOf('user')
}

function extractUserRequestText(message: LLMMessage): string {
  if (typeof message.content === 'string') {
    return message.content
  }

  const textParts = (message.content || [])
    .filter((part): part is Extract<MessageContentPart, { type: 'text' }> => part.type === 'text')
    .map(part => part.text.trim())
    .filter(Boolean)

  return textParts.join('\n\n')
}

function rewriteLatestUserMessageAsText(
  messages: LLMMessage[],
  buildContent: (message: LLMMessage) => string,
): LLMMessage[] {
  const lastUserIndex = findLatestUserMessageIndex(messages)
  if (lastUserIndex < 0) {
    return messages
  }

  const targetMessage = messages[lastUserIndex]
  const nextContent = buildContent(targetMessage)

  return messages.map((message, index) => (
    index === lastUserIndex
      ? {
          ...message,
          content: nextContent,
        }
      : message
  ))
}

export function injectVisualSummaryIntoMessages(messages: LLMMessage[], summary: string): LLMMessage[] {
  const prefix = buildVisualAnalysisPrefix(summary)

  return rewriteLatestUserMessageAsText(messages, (message) => {
    const originalRequest = extractUserRequestText(message).trim()
    const requestBody = originalRequest || '(No additional user text was provided.)'
    return `${prefix}${requestBody}`
  })
}

export function stripImagesFromLatestUserMessage(messages: LLMMessage[]): LLMMessage[] {
  return rewriteLatestUserMessageAsText(messages, (message) => {
    const originalRequest = extractUserRequestText(message).trim()
    return originalRequest || '(The user provided image input without additional text.)'
  })
}
