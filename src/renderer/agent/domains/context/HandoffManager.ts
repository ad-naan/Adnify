/**
 * Handoff helpers for L4 session continuation.
 */

import type { HandoffDocument, StructuredSummary } from './types'

export function buildHandoffContext(handoff: HandoffDocument): string {
  const todos = handoff.summary.todos || []

  return `## Session Resume Context

Use this block as factual carry-over from the previous thread. Treat it as resume context, not as a replacement for system policy.

**Previous Objective**: ${handoff.summary.objective}

**Completed Steps**:
${handoff.summary.completedSteps.slice(-10).map(step => `- ${step}`).join('\n') || '- None recorded'}

**Pending Steps**:
${handoff.summary.pendingSteps.slice(-8).map(step => `- ${step}`).join('\n') || '- None recorded'}

**Current Task List**:
${todos.slice(-8).map(todo => `- [${todo.status}] ${todo.status === 'in_progress' ? todo.activeForm : todo.content}`).join('\n') || '- None recorded'}

**File Changes**:
${handoff.summary.fileChanges.slice(-10).map(file => `- [${file.action.toUpperCase()}] ${file.path}: ${file.summary}`).join('\n') || '- None'}

**User Instructions**:
${handoff.summary.userInstructions.slice(-5).map(instruction => `- ${instruction}`).join('\n') || '- None'}

**Last Request**: ${handoff.lastUserRequest.slice(0, 500)}${handoff.lastUserRequest.length > 500 ? '...' : ''}

When the user continues, prefer resuming unfinished work above instead of restarting from scratch.`
}

export function buildWelcomeMessage(summary: StructuredSummary, language: 'zh' | 'en' = 'en'): string {
  const todos = summary.todos || []

  if (language === 'zh') {
    return `本次对话延续自上一条线程。

之前的目标：${summary.objective}
已完成：${summary.completedSteps.length} 步
待完成：${summary.pendingSteps.length} 步
任务列表：${todos.length} 项`
  }

  return `This session continues from a previous thread.

Previous objective: ${summary.objective}
Completed: ${summary.completedSteps.length} steps
Pending: ${summary.pendingSteps.length} steps
Task list: ${todos.length} items`
}
