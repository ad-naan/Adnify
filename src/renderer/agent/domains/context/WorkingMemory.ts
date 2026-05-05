import type { StructuredSummary } from './types'

export interface WorkingMemoryHealth {
  score: number
  coverage: {
    objective: boolean
    pendingSteps: boolean
    completedSteps: boolean
    userInstructions: boolean
    fileChanges: boolean
    todos: boolean
  }
  staleTurns: number
  risk: 'low' | 'medium' | 'high'
}

function bulletList(items: string[], fallback = '- None recorded', limit = 8): string {
  const visible = items.map(item => item.trim()).filter(Boolean).slice(-limit)
  if (visible.length === 0) return fallback
  return visible.map(item => `- ${item}`).join('\n')
}

export function buildWorkingMemoryContext(summary: StructuredSummary): string {
  const todos = summary.todos || []
  const fileChanges = summary.fileChanges || []
  const userInstructions = summary.userInstructions || []
  const errorsAndFixes = summary.errorsAndFixes || []

  return `## Working Memory

Use this block as the current task state distilled from earlier conversation. It is factual carry-over and should be preserved even when raw history is compressed.

**Current Objective**: ${summary.objective || 'Unknown objective'}

**Pending Steps**:
${bulletList(summary.pendingSteps || [], '- None recorded', 8)}

**Completed Steps**:
${bulletList(summary.completedSteps || [], '- None recorded', 10)}

**Task List**:
${todos.slice(-10).map(todo => `- [${todo.status}] ${todo.status === 'in_progress' ? todo.activeForm : todo.content}`).join('\n') || '- None recorded'}

**File Changes**:
${fileChanges.slice(-12).map(file => `- [${file.action.toUpperCase()}] ${file.path}: ${file.summary}`).join('\n') || '- None'}

**User Instructions**:
${bulletList(userInstructions, '- None recorded', 6)}

**Errors And Fixes**:
${errorsAndFixes.slice(-6).map(item => `- ${item.error}: ${item.fix}`).join('\n') || '- None recorded'}

When recent raw history and this memory disagree, prefer the most recent raw user message. Otherwise treat this memory as the continuity layer for compressed history.`
}

export function calculateWorkingMemoryHealth(
  summary: StructuredSummary | null | undefined,
  currentUserTurns: number
): WorkingMemoryHealth {
  if (!summary) {
    return {
      score: 0,
      coverage: {
        objective: false,
        pendingSteps: false,
        completedSteps: false,
        userInstructions: false,
        fileChanges: false,
        todos: false,
      },
      staleTurns: currentUserTurns,
      risk: 'high',
    }
  }

  const coverage = {
    objective: Boolean(summary.objective?.trim()),
    pendingSteps: (summary.pendingSteps || []).length > 0,
    completedSteps: (summary.completedSteps || []).length > 0,
    userInstructions: (summary.userInstructions || []).length > 0,
    fileChanges: (summary.fileChanges || []).length > 0,
    todos: (summary.todos || []).length > 0,
  }

  const weights: Record<keyof typeof coverage, number> = {
    objective: 28,
    pendingSteps: 24,
    completedSteps: 14,
    userInstructions: 14,
    fileChanges: 12,
    todos: 8,
  }

  const coveredScore = Object.entries(coverage).reduce((total, [key, covered]) => {
    return total + (covered ? weights[key as keyof typeof coverage] : 0)
  }, 0)
  const lastCoveredTurn = summary.turnRange?.[1] ?? 0
  const staleTurns = Math.max(0, currentUserTurns - lastCoveredTurn)
  const freshnessPenalty = Math.min(30, staleTurns * 10)
  const score = Math.max(0, Math.min(100, coveredScore - freshnessPenalty))
  const risk = score >= 80 ? 'low' : score >= 55 ? 'medium' : 'high'

  return {
    score,
    coverage,
    staleTurns,
    risk,
  }
}
