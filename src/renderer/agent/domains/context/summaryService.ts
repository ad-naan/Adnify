/**
 * Summary generation service.
 *
 * Used for:
 * - L3 detailed summary generation
 * - L4 handoff document generation
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { getAgentConfig } from '../../utils/AgentConfig'
import type { StructuredSummary, HandoffDocument, FileChangeRecord } from './types'
import {
  HANDOFF_SUMMARY_JSON_SCHEMA,
  getStructuredOutputErrorMessage,
  isRecoverableStructuredOutputError,
  normalizeHandoffSummary,
  type NormalizedHandoffSummary,
} from './handoffSummaryContract'
import type {
  ChatMessage,
  AssistantMessage,
  UserMessage,
  ToolResultMessage,
  TodoItem,
} from '../../types'
import { getMessageText } from '../../types'

const HANDOFF_SYSTEM_PROMPT = `You are analyzing a conversation to extract structured information for session handoff.

Return exactly one JSON object using these exact keys and no aliases:
- objective: string
- completedSteps: string[]
- pendingSteps: string[]
- keyDecisions: string[]
- userConstraints: string[]
- lastRequestStatus: "completed" | "partial" | "not_started"

Rules:
- Do not use alternate keys such as mainObjective, completedSoFar, technicalDecisions, specialRequirementsOrConstraints, or lastUserRequestStatus.
- Do not add extra top-level keys.
- pendingSteps must include the last user request when it was not fully completed.
- Arrays must contain short plain strings only.
- Output valid JSON only. No markdown.`

const HANDOFF_TEXT_FALLBACK_SYSTEM_PROMPT = `You are generating a strict handoff JSON document.

Return valid JSON only, with exactly these top-level keys:
- objective
- completedSteps
- pendingSteps
- keyDecisions
- userConstraints
- lastRequestStatus

Constraints:
- objective is a string
- completedSteps, pendingSteps, keyDecisions, userConstraints are arrays of strings
- lastRequestStatus must be one of: "completed", "partial", "not_started"
- Do not use any alias keys
- Do not add any other keys
- Do not wrap the JSON in markdown fences`

const SUMMARY_PROMPT = `Summarize what was done in this conversation. Write like a pull request description.

Rules:
- 2-3 sentences max
- Describe the changes made, not the process
- Do not mention running tests, builds, or other validation steps
- Do not explain what the user asked for
- Write in first person (I added..., I fixed...)
- Never ask questions or add new questions`

const HANDOFF_TEXT_FALLBACK_MAX_TOKENS = 2000

export interface SummaryResult {
  summary: string
  objective: string
  completedSteps: string[]
  pendingSteps: string[]
  fileChanges: FileChangeRecord[]
  todos: TodoItem[]
  source: 'llm' | 'rule_based'
  fallbackReason?: string
}

function extractJSONObject(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed
  }

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    return null
  }

  return trimmed.slice(start, end + 1)
}

async function generateHandoffSummaryFromTextFallback(
  userPrompt: string,
  llmConfig: import('@store').LLMConfig,
) {
  const fallbackResult = await api.llm.compactContext({
    config: {
      ...llmConfig,
      maxTokens: HANDOFF_TEXT_FALLBACK_MAX_TOKENS,
      temperature: 0,
      toolChoice: 'none',
    },
    messages: [
      { role: 'system', content: HANDOFF_TEXT_FALLBACK_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  })

  if (fallbackResult.error || !fallbackResult.content) {
    throw new Error(fallbackResult.error || 'Text fallback did not return any content.')
  }

  const jsonText = extractJSONObject(fallbackResult.content)
  if (!jsonText) {
    throw new Error('Text fallback did not return a valid JSON object.')
  }

  return JSON.parse(jsonText) as unknown
}

function normalizeTodos(todos?: TodoItem[]): TodoItem[] {
  if (!Array.isArray(todos)) return []

  return todos
    .filter(todo => todo && typeof todo.content === 'string' && typeof todo.activeForm === 'string')
    .map(todo => ({
      content: todo.content.trim(),
      status: todo.status,
      activeForm: todo.activeForm.trim(),
    }))
    .filter(todo => Boolean(todo.content) && Boolean(todo.activeForm))
}

function buildTodoContext(todos: TodoItem[]): string {
  if (todos.length === 0) return ''

  const lines = todos.map(todo => {
    const marker = todo.status === 'completed' ? '[done]' : todo.status === 'in_progress' ? '[doing]' : '[todo]'
    const text = todo.status === 'in_progress' ? todo.activeForm : todo.content
    return `${marker} ${text}`
  })

  return `Active task list:\n${lines.join('\n')}`
}

function mergePendingSteps(baseSteps: string[], todos: TodoItem[], lastUserRequest?: string): string[] {
  const merged: string[] = []
  const seen = new Set<string>()

  const pushUnique = (value: string) => {
    const normalized = value.trim()
    if (!normalized) return
    const key = normalized.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    merged.push(normalized)
  }

  for (const step of baseSteps) {
    pushUnique(step)
  }

  for (const todo of todos) {
    if (todo.status !== 'completed') {
      pushUnique(`Task: ${todo.content}`)
    }
  }

  if (lastUserRequest) {
    pushUnique(`Continue: ${lastUserRequest.slice(0, 100)}${lastUserRequest.length > 100 ? '...' : ''}`)
  }

  return merged
}

function extractFileChanges(messages: ChatMessage[]): FileChangeRecord[] {
  const changes: FileChangeRecord[] = []
  let turnIndex = 0

  for (const msg of messages) {
    if (msg.role === 'user') turnIndex++

    if (msg.role === 'assistant') {
      const assistantMsg = msg as AssistantMessage
      for (const tc of assistantMsg.toolCalls || []) {
        if (tc.status !== 'success') continue

        const args = tc.arguments as Record<string, unknown>
        const path = args.path as string

        if (tc.name === 'write_file' || tc.name === 'create_file') {
          changes.push({ path, action: 'create', summary: `Created ${path}`, turnIndex })
        } else if (tc.name === 'edit_file') {
          changes.push({ path, action: 'modify', summary: `Modified ${path}`, turnIndex })
        } else if (tc.name === 'delete_file') {
          changes.push({ path, action: 'delete', summary: `Deleted ${path}`, turnIndex })
        }
      }
    }
  }

  return changes
}

function extractUserRequests(messages: ChatMessage[]): string[] {
  const requests: string[] = []

  for (const msg of messages) {
    if (msg.role !== 'user') continue

    const userMsg = msg as UserMessage
    const content = getMessageText(userMsg.content)
    if (content.trim()) {
      requests.push(content.slice(0, 200))
    }
  }

  return requests
}

function buildHandoffSummaryResult(
  parsed: NormalizedHandoffSummary,
  options: {
    objectiveFallback: string
    completedStepsFallback: string[]
    fileChanges: FileChangeRecord[]
    todos: TodoItem[]
    lastUserRequest: string
  },
): SummaryResult {
  const objective = parsed.objective || options.objectiveFallback
  const completedSteps = parsed.completedSteps.length > 0
    ? parsed.completedSteps
    : options.completedStepsFallback
  const pendingSteps = mergePendingSteps(
    parsed.pendingSteps,
    options.todos,
    parsed.lastRequestStatus !== 'completed' ? options.lastUserRequest : undefined,
  )

  return {
    summary: `**Objective**: ${objective}\n\n` +
      `**Completed**: ${completedSteps.length} steps\n` +
      `**Pending**: ${pendingSteps.length} steps\n` +
      `**Task List**: ${options.todos.length} item(s)\n` +
      (parsed.keyDecisions.length > 0 ? `**Key Decisions**: ${parsed.keyDecisions.join('; ')}\n` : '') +
      (parsed.userConstraints.length > 0 ? `**Constraints**: ${parsed.userConstraints.join('; ')}` : ''),
    objective,
    completedSteps,
    pendingSteps,
    fileChanges: options.fileChanges,
    todos: options.todos,
    source: 'llm',
  }
}

function extractAssistantSummary(message: AssistantMessage): string {
  const directContent = (message.content || '').trim()
  if (directContent) return directContent

  const partTexts = message.parts
    .map(part => {
      switch (part.type) {
        case 'text':
        case 'reasoning':
        case 'search':
          return part.content
        case 'system_alert':
          return [part.title, part.message, part.suggestion].filter(Boolean).join(' - ')
        default:
          return ''
      }
    })
    .filter(Boolean)

  return partTexts.join('\n').trim()
}

function buildConversationText(messages: ChatMessage[], maxLength = 8000): string {
  const parts: string[] = []
  let totalLength = 0

  for (let i = messages.length - 1; i >= 0 && totalLength < maxLength; i--) {
    const msg = messages[i]
    let text = ''

    if (msg.role === 'user') {
      const content = getMessageText((msg as UserMessage).content)
      text = `User: ${content.slice(0, 500)}`
    } else if (msg.role === 'assistant') {
      const assistantMsg = msg as AssistantMessage
      text = `Assistant: ${extractAssistantSummary(assistantMsg).slice(0, 500)}`

      if (assistantMsg.toolCalls?.length) {
        const toolSummary = assistantMsg.toolCalls
          .filter(tc => tc.status === 'success')
          .map(tc => `- ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 100)})`)
          .join('\n')
        if (toolSummary) {
          text += `\nTools used:\n${toolSummary}`
        }
      }
    } else if (msg.role === 'tool') {
      const toolMsg = msg as ToolResultMessage
      text = `Tool ${toolMsg.name}: ${String(toolMsg.content || '').slice(0, 400)}`
    } else if (msg.role === 'interrupted_tool') {
      text = `Interrupted tool: ${msg.name}`
    }

    if (!text) continue

    parts.unshift(text)
    totalLength += text.length
  }

  return parts.join('\n\n')
}

export async function generateSummary(
  messages: ChatMessage[],
  options: {
    type: 'quick' | 'detailed' | 'handoff'
    maxTokens?: number
    todos?: TodoItem[]
  } = { type: 'quick' }
): Promise<SummaryResult> {
  const { llmConfig } = useStore.getState()
  const todos = normalizeTodos(options.todos)
  const userRequests = extractUserRequests(messages)
  const lastUserRequest = userRequests[userRequests.length - 1]

  if (!llmConfig.apiKey) {
    return generateRuleBasedSummary(
      messages,
      options.type === 'handoff' ? lastUserRequest : undefined,
      todos,
    )
  }

  const agentConfig = getAgentConfig()
  const maxContextLength = agentConfig.summaryMaxContextChars[options.type]
  const conversationText = buildConversationText(messages, maxContextLength)
  const todoContext = buildTodoContext(todos)
  const fileChanges = extractFileChanges(messages)

  if (options.type === 'handoff') {
    return generateHandoffSummary(messages, conversationText, fileChanges, userRequests, todos, todoContext, llmConfig)
  }

  const userPrompt = [
    'Please summarize the following conversation:',
    todoContext,
    conversationText,
  ].filter(Boolean).join('\n\n')

  try {
    const result = await api.llm.compactContext({
      config: {
        ...llmConfig,
        maxTokens: options.maxTokens || 500,
        temperature: 0.3,
      },
      messages: [
        { role: 'system', content: SUMMARY_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    })

    if (result.error) {
      logger.agent.warn('[SummaryService] LLM error, falling back to rule-based:', result.error)
      return generateRuleBasedSummary(messages, undefined, todos)
    }

    return {
      summary: result.content || '',
      objective: userRequests[0] || 'Unknown objective',
      completedSteps: extractCompletedSteps(messages),
      pendingSteps: mergePendingSteps([], todos),
      fileChanges,
      todos,
      source: 'llm',
    }
  } catch (error) {
    const fallbackReason = getStructuredOutputErrorMessage(error)
    logger.agent.warn('[SummaryService] Summary generation failed, falling back to rule-based:', error)
    return generateRuleBasedSummary(messages, undefined, todos, fallbackReason)
  }
}

async function generateHandoffSummary(
  messages: ChatMessage[],
  conversationText: string,
  fileChanges: FileChangeRecord[],
  userRequests: string[],
  todos: TodoItem[],
  todoContext: string,
  llmConfig: import('@store').LLMConfig
): Promise<SummaryResult> {
  const lastUserRequest = userRequests[userRequests.length - 1] || ''
  const objectiveFallback = userRequests[0] || 'Unknown objective'
  const completedStepsFallback = extractCompletedSteps(messages)
  const userPrompt = [
    'Analyze the following conversation:',
    todoContext,
    conversationText,
    `Last user request: "${lastUserRequest}"`,
  ].filter(Boolean).join('\n\n')

  try {
    const result = await api.llm.generateObject({
      config: {
        ...llmConfig,
        maxTokens: 1000,
        temperature: 0.2,
      },
      schema: HANDOFF_SUMMARY_JSON_SCHEMA,
      system: HANDOFF_SYSTEM_PROMPT,
      prompt: userPrompt,
    })

    if (result.error || !result.object) {
      const fallbackReason = result.error || 'Structured handoff summary returned no object.'
      logger.agent.warn('[SummaryService] Structured handoff failed, trying text JSON fallback:', fallbackReason)

      const fallbackObject = await generateHandoffSummaryFromTextFallback(userPrompt, llmConfig)
      const parsedFallback = normalizeHandoffSummary(fallbackObject, {
        objective: objectiveFallback,
        completedSteps: completedStepsFallback,
        pendingSteps: [],
      })

      return buildHandoffSummaryResult(parsedFallback, {
        objectiveFallback,
        completedStepsFallback,
        fileChanges,
        todos,
        lastUserRequest,
      })
    }

    const parsed = normalizeHandoffSummary(result.object, {
      objective: objectiveFallback,
      completedSteps: completedStepsFallback,
      pendingSteps: [],
    })
    return buildHandoffSummaryResult(parsed, {
      objectiveFallback,
      completedStepsFallback,
      fileChanges,
      todos,
      lastUserRequest,
    })
  } catch (error) {
    const fallbackReason = getStructuredOutputErrorMessage(error)
    if (isRecoverableStructuredOutputError(error)) {
      try {
        logger.agent.warn('[SummaryService] Handoff summary failed, trying text JSON fallback:', fallbackReason)
        const fallbackObject = await generateHandoffSummaryFromTextFallback(userPrompt, llmConfig)
        const parsed = normalizeHandoffSummary(fallbackObject, {
          objective: objectiveFallback,
          completedSteps: completedStepsFallback,
          pendingSteps: [],
        })
        return buildHandoffSummaryResult(parsed, {
          objectiveFallback,
          completedStepsFallback,
          fileChanges,
          todos,
          lastUserRequest,
        })
      } catch (fallbackError) {
        logger.agent.warn('[SummaryService] Text JSON fallback failed, using rule-based handoff:', fallbackError)
      }
    } else {
      logger.agent.error('[SummaryService] Handoff summary failed, falling back to rule-based:', fallbackReason)
    }

    return generateRuleBasedSummary(messages, lastUserRequest, todos, fallbackReason)
  }
}

function generateRuleBasedSummary(
  messages: ChatMessage[],
  lastUserRequest?: string,
  todos: TodoItem[] = [],
  fallbackReason?: string,
): SummaryResult {
  const fileChanges = extractFileChanges(messages)
  const userRequests = extractUserRequests(messages)
  const completedSteps = extractCompletedSteps(messages)

  let pendingSteps: string[] = []
  if (lastUserRequest) {
    const lastMessages = messages.slice(-5)
    const hasRecentSuccess = lastMessages.some(m =>
      m.role === 'assistant' &&
      (m as AssistantMessage).toolCalls?.some(tc => tc.status === 'success')
    )

    if (!hasRecentSuccess) {
      pendingSteps.push(`Continue: ${lastUserRequest.slice(0, 100)}${lastUserRequest.length > 100 ? '...' : ''}`)
    }
  }

  pendingSteps = mergePendingSteps(pendingSteps, todos)

  const parts: string[] = []

  if (userRequests.length > 0) {
    parts.push(`Objective: ${userRequests[0].slice(0, 100)}`)
  }

  if (fileChanges.length > 0) {
    parts.push(`Files modified: ${fileChanges.length}`)
    parts.push(fileChanges.slice(-5).map(f => `- ${f.action}: ${f.path}`).join('\n'))
  }

  if (completedSteps.length > 0) {
    parts.push(`Completed: ${completedSteps.length} steps`)
  }

  if (pendingSteps.length > 0) {
    parts.push(`Pending: ${pendingSteps.join('; ')}`)
  }

  if (todos.length > 0) {
    parts.push(`Task list: ${todos.length} item(s), ${todos.filter(todo => todo.status === 'completed').length} completed`)
  }

  return {
    summary: parts.join('\n'),
    objective: userRequests[0] || 'Unknown objective',
    completedSteps,
    pendingSteps,
    fileChanges,
    todos,
    source: 'rule_based',
    fallbackReason,
  }
}

function extractCompletedSteps(messages: ChatMessage[]): string[] {
  const steps: string[] = []

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue

    const assistantMsg = msg as AssistantMessage
    for (const tc of assistantMsg.toolCalls || []) {
      if (tc.status !== 'success') continue

      const args = tc.arguments as Record<string, unknown>
      switch (tc.name) {
        case 'write_file':
        case 'create_file':
          steps.push(`Created file: ${args.path}`)
          break
        case 'edit_file':
          steps.push(`Modified file: ${args.path}`)
          break
        case 'execute_command':
        case 'run_terminal_command':
          steps.push(`Executed: ${String(args.command || args.cmd).slice(0, 50)}`)
          break
        case 'read_file':
          steps.push(`Read file: ${args.path}`)
          break
      }
    }
  }

  return steps.slice(-20)
}

export async function generateHandoffDocument(
  sessionId: string,
  messages: ChatMessage[],
  workspacePath: string,
  todos: TodoItem[] = []
): Promise<{ handoff: HandoffDocument; source: SummaryResult['source']; error?: string }> {
  const normalizedTodos = normalizeTodos(todos)
  const summaryResult = await generateSummary(messages, {
    type: 'handoff',
    maxTokens: 1000,
    todos: normalizedTodos,
  })
  const userRequests = extractUserRequests(messages)
  const lastUserRequest = userRequests[userRequests.length - 1] || ''

  const structuredSummary: StructuredSummary = {
    objective: summaryResult.objective,
    completedSteps: summaryResult.completedSteps,
    pendingSteps: summaryResult.pendingSteps,
    todos: summaryResult.todos,
    decisions: [],
    fileChanges: summaryResult.fileChanges,
    errorsAndFixes: [],
    userInstructions: userRequests.slice(-5),
    generatedAt: Date.now(),
    turnRange: [0, messages.filter(m => m.role === 'user').length],
  }

  return {
    handoff: {
      fromSessionId: sessionId,
      createdAt: Date.now(),
      summary: structuredSummary,
      workingDirectory: workspacePath,
      keyFileSnapshots: [],
      lastUserRequest,
      suggestedNextSteps: summaryResult.pendingSteps,
    },
    source: summaryResult.source,
    error: summaryResult.source === 'rule_based' ? summaryResult.fallbackReason : undefined,
  }
}
