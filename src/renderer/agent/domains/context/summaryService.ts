/**
 * 摘要生成服务
 * 
 * 参考 OpenCode 的实现：
 * - 使用 LLM 生成对话摘要
 * - 用于 L3 深度压缩和 L4 会话交接
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { getAgentConfig } from '../../utils/AgentConfig'
import type { StructuredSummary, HandoffDocument, FileChangeRecord } from './types'
import type { ChatMessage, AssistantMessage, UserMessage } from '../../types'
import { getMessageText } from '../../types'

// ===== Prompts =====

const HANDOFF_SYSTEM_PROMPT = `You are analyzing a conversation to extract structured information for session handoff.

Your task is to identify:
1. The main objective the user is trying to achieve
2. What has been completed so far
3. What still needs to be done (CRITICAL: include the last user request if it wasn't fully completed)
4. Key technical decisions that were made
5. Any special requirements or constraints the user mentioned
6. Whether the last user request was completed, partially done, or not started

Be thorough and accurate. If the last user message contains a request that wasn't fully addressed, it MUST appear in pendingSteps.`

const SUMMARY_PROMPT = `Summarize what was done in this conversation. Write like a pull request description.

Rules:
- 2-3 sentences max
- Describe the changes made, not the process
- Do not mention running tests, builds, or other validation steps
- Do not explain what the user asked for
- Write in first person (I added..., I fixed...)
- Never ask questions or add new questions`

// ===== Types =====

export interface SummaryResult {
  summary: string
  objective: string
  completedSteps: string[]
  pendingSteps: string[]
  fileChanges: FileChangeRecord[]
}

// ===== Helper Functions =====

/**
 * 从消息中提取文件变更记录
 */
function extractFileChanges(messages: ChatMessage[]): FileChangeRecord[] {
  const changes: FileChangeRecord[] = []
  let turnIndex = 0

  for (const msg of messages) {
    if (msg.role === 'user') turnIndex++

    if (msg.role === 'assistant') {
      const assistantMsg = msg as AssistantMessage
      for (const tc of assistantMsg.toolCalls || []) {
        if (tc.status === 'success') {
          const args = tc.arguments as Record<string, unknown>
          const path = args.path as string

          if (tc.name === 'write_file' || tc.name === 'create_file') {
            changes.push({
              path,
              action: 'create',
              summary: `Created ${path}`,
              turnIndex,
            })
          } else if (tc.name === 'edit_file') {
            changes.push({
              path,
              action: 'modify',
              summary: `Modified ${path}`,
              turnIndex,
            })
          } else if (tc.name === 'delete_file') {
            changes.push({
              path,
              action: 'delete',
              summary: `Deleted ${path}`,
              turnIndex,
            })
          }
        }
      }
    }
  }

  return changes
}

/**
 * 从消息中提取用户请求
 */
function extractUserRequests(messages: ChatMessage[]): string[] {
  const requests: string[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      const userMsg = msg as UserMessage
      const content = getMessageText(userMsg.content)

      if (content.trim()) {
        requests.push(content.slice(0, 200))
      }
    }
  }

  return requests
}

/**
 * 构建用于摘要的消息文本
 */
function buildConversationText(messages: ChatMessage[], maxLength = 8000): string {
  const parts: string[] = []
  let totalLength = 0

  // 从后往前取消息，确保最近的对话被包含
  for (let i = messages.length - 1; i >= 0 && totalLength < maxLength; i--) {
    const msg = messages[i]
    let text = ''

    if (msg.role === 'user') {
      const content = typeof (msg as UserMessage).content === 'string'
        ? (msg as UserMessage).content as string
        : ''
      text = `User: ${content.slice(0, 500)}`
    } else if (msg.role === 'assistant') {
      const assistantMsg = msg as AssistantMessage
      text = `Assistant: ${(assistantMsg.content || '').slice(0, 500)}`

      // 添加工具调用摘要
      if (assistantMsg.toolCalls?.length) {
        const toolSummary = assistantMsg.toolCalls
          .filter(tc => tc.status === 'success')
          .map(tc => `- ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 100)})`)
          .join('\n')
        if (toolSummary) {
          text += `\nTools used:\n${toolSummary}`
        }
      }
    }

    if (text) {
      parts.unshift(text)
      totalLength += text.length
    }
  }

  return parts.join('\n\n')
}

// ===== Main Service =====

/**
 * 使用 LLM 生成对话摘要
 */
export async function generateSummary(
  messages: ChatMessage[],
  options: {
    type: 'quick' | 'detailed' | 'handoff'
    maxTokens?: number
  } = { type: 'quick' }
): Promise<SummaryResult> {
  const { llmConfig } = useStore.getState()

  // 如果没有配置 API Key，返回基于规则的摘要
  if (!llmConfig.apiKey) {
    return generateRuleBasedSummary(messages)
  }

  // 从配置中获取上下文长度限制
  const agentConfig = getAgentConfig()
  const maxContextLength = agentConfig.summaryMaxContextChars[options.type]
  const conversationText = buildConversationText(messages, maxContextLength)
  const fileChanges = extractFileChanges(messages)
  const userRequests = extractUserRequests(messages)

  // Handoff 模式：使用结构化提示词
  if (options.type === 'handoff') {
    return generateHandoffSummary(messages, conversationText, fileChanges, userRequests, llmConfig)
  }

  // Quick/Detailed 模式：使用简单摘要
  const prompt = SUMMARY_PROMPT
  const userPrompt = `Please summarize the following conversation:\n\n${conversationText}`

  try {
    const result = await api.llm.compactContext({
      config: {
        provider: llmConfig.provider,
        model: llmConfig.model,
        apiKey: llmConfig.apiKey,
        baseUrl: llmConfig.baseUrl,
        timeout: llmConfig.timeout,
        maxTokens: options.maxTokens || 500,
        temperature: 0.3,
      },
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: userPrompt },
      ],
    })

    if (result.error) {
      logger.agent.warn('[SummaryService] LLM error, falling back to rule-based:', result.error)
      return generateRuleBasedSummary(messages)
    }

    const summary = result.content || ''

    return {
      summary,
      objective: userRequests[0] || 'Unknown objective',
      completedSteps: extractCompletedSteps(messages),
      pendingSteps: [],
      fileChanges,
    }
  } catch (error) {
    logger.agent.error('[SummaryService] Error generating summary:', error)
    return generateRuleBasedSummary(messages)
  }
}

/**
 * 生成 Handoff 专用的结构化摘要（使用 AI SDK generateObject）
 */
async function generateHandoffSummary(
  messages: ChatMessage[],
  conversationText: string,
  fileChanges: FileChangeRecord[],
  userRequests: string[],
  llmConfig: import('@store').LLMConfig
): Promise<SummaryResult> {
  const lastUserRequest = userRequests[userRequests.length - 1] || ''

  const userPrompt = `Analyze the following conversation:\n\n${conversationText}\n\nLast user request: "${lastUserRequest}"`

  try {
    // 使用 generateObject 确保结构化输出
    // 注意：schema 需要转换为可序列化的格式传递给主进程
    const result = await api.llm.generateObject({
      config: {
        provider: llmConfig.provider,
        model: llmConfig.model,
        apiKey: llmConfig.apiKey,
        baseUrl: llmConfig.baseUrl,
        timeout: llmConfig.timeout,
        maxTokens: 1000,
        temperature: 0.2,
      },
      // 将 Zod schema 转换为 JSON Schema（主进程会重新构建 Zod schema）
      schema: {
        type: 'object',
        properties: {
          objective: { type: 'string', description: 'What the user is trying to achieve' },
          completedSteps: { type: 'array', items: { type: 'string' }, description: 'What has been done' },
          pendingSteps: { type: 'array', items: { type: 'string' }, description: 'What still needs to be done' },
          keyDecisions: { type: 'array', items: { type: 'string' }, description: 'Important technical decisions' },
          userConstraints: { type: 'array', items: { type: 'string' }, description: 'Special requirements' },
          lastRequestStatus: { type: 'string', enum: ['completed', 'partial', 'not_started'], description: 'Status of last request' }
        },
        required: ['objective', 'completedSteps', 'pendingSteps', 'keyDecisions', 'userConstraints', 'lastRequestStatus']
      },
      system: HANDOFF_SYSTEM_PROMPT,
      prompt: userPrompt,
    })

    if (result.error || !result.object) {
      logger.agent.warn('[SummaryService] Handoff generation failed, falling back to rule-based:', result.error)
      return generateRuleBasedSummary(messages, lastUserRequest)
    }

    const parsed = result.object

    // 验证并提取字段
    const objective = parsed.objective || userRequests[0] || 'Unknown objective'
    const completedSteps = parsed.completedSteps || extractCompletedSteps(messages)
    let pendingSteps = parsed.pendingSteps || []

    // 确保最后一个未完成的请求在 pendingSteps 中
    if (parsed.lastRequestStatus !== 'completed' && lastUserRequest) {
      const lastRequestInPending = pendingSteps.some((step: string) =>
        step.toLowerCase().includes(lastUserRequest.slice(0, 30).toLowerCase())
      )
      if (!lastRequestInPending) {
        pendingSteps.unshift(`Continue: ${lastUserRequest.slice(0, 100)}${lastUserRequest.length > 100 ? '...' : ''}`)
      }
    }

    const summary = `**Objective**: ${objective}\n\n` +
      `**Completed**: ${completedSteps.length} steps\n` +
      `**Pending**: ${pendingSteps.length} steps\n` +
      (parsed.keyDecisions?.length > 0 ? `**Key Decisions**: ${parsed.keyDecisions.join('; ')}\n` : '') +
      (parsed.userConstraints?.length > 0 ? `**Constraints**: ${parsed.userConstraints.join('; ')}` : '')

    return {
      summary,
      objective,
      completedSteps,
      pendingSteps,
      fileChanges,
    }
  } catch (error) {
    logger.agent.error('[SummaryService] Error generating handoff summary:', error)
    return generateRuleBasedSummary(messages, lastUserRequest)
  }
}

/**
 * 基于规则生成摘要（不使用 LLM）
 */
function generateRuleBasedSummary(messages: ChatMessage[], lastUserRequest?: string): SummaryResult {
  const fileChanges = extractFileChanges(messages)
  const userRequests = extractUserRequests(messages)
  const completedSteps = extractCompletedSteps(messages)

  // 检测最后一个请求是否完成
  const pendingSteps: string[] = []
  if (lastUserRequest) {
    // 简单启发式：如果最后几条消息中没有成功的工具调用，认为请求未完成
    const lastMessages = messages.slice(-5)
    const hasRecentSuccess = lastMessages.some(m =>
      m.role === 'assistant' &&
      (m as import('../../types').AssistantMessage).toolCalls?.some(tc => tc.status === 'success')
    )

    if (!hasRecentSuccess) {
      pendingSteps.push(`Continue: ${lastUserRequest.slice(0, 100)}${lastUserRequest.length > 100 ? '...' : ''}`)
    }
  }

  // 构建简单摘要
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

  return {
    summary: parts.join('\n'),
    objective: userRequests[0] || 'Unknown objective',
    completedSteps,
    pendingSteps,
    fileChanges,
  }
}

/**
 * 从消息中提取已完成的步骤
 */
function extractCompletedSteps(messages: ChatMessage[]): string[] {
  const steps: string[] = []

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      const assistantMsg = msg as AssistantMessage
      for (const tc of assistantMsg.toolCalls || []) {
        if (tc.status === 'success') {
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
    }
  }

  return steps.slice(-20) // 保留最近 20 个步骤
}

/**
 * 生成 Handoff 文档
 */
export async function generateHandoffDocument(
  sessionId: string,
  messages: ChatMessage[],
  workspacePath: string
): Promise<HandoffDocument> {
  const summaryResult = await generateSummary(messages, { type: 'handoff', maxTokens: 1000 })
  const userRequests = extractUserRequests(messages)
  const lastUserRequest = userRequests[userRequests.length - 1] || ''

  const structuredSummary: StructuredSummary = {
    objective: summaryResult.objective,
    completedSteps: summaryResult.completedSteps,
    pendingSteps: summaryResult.pendingSteps,
    decisions: [],
    fileChanges: summaryResult.fileChanges,
    errorsAndFixes: [],
    userInstructions: userRequests.slice(-5),
    generatedAt: Date.now(),
    turnRange: [0, messages.filter(m => m.role === 'user').length],
  }

  return {
    fromSessionId: sessionId,
    createdAt: Date.now(),
    summary: structuredSummary,
    workingDirectory: workspacePath,
    keyFileSnapshots: [],
    lastUserRequest,
    suggestedNextSteps: summaryResult.pendingSteps,
  }
}

logger.agent.info('[SummaryService] Module loaded')
