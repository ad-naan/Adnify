import type { AssistantPart } from '@renderer/agent/types'
import { isReasoningPart, isSearchPart, isSystemAlertPart, isTextPart, isToolCallPart, isLintCheckPart, isContextSnapshotPart, isSourcesPart } from '@renderer/agent/types'

export interface AssistantTurnProjectionOptions {
  isStreaming?: boolean
  isAwaitingApproval?: boolean
  expandProcessByDefault?: boolean
  hasContextMeta?: boolean
}

export interface AssistantProcessSummary {
  toolCallCount: number
  hasReasoning: boolean
  hasSearch: boolean
  hasContext: boolean
  hasSources: boolean
  hasLintCheck: boolean
  hasSystemAlert: boolean
  hasProcessText: boolean
}

export interface AssistantTurnProjection {
  finalReplyParts: AssistantPart[]
  processParts: AssistantPart[]
  hasVisibleFinalReply: boolean
  hasProcessContent: boolean
  shouldCollapseProcess: boolean
  summary: AssistantProcessSummary
}

function isNonEmptyTextPart(part: AssistantPart): boolean {
  return isTextPart(part) && part.content.trim().length > 0
}

function findFinalReplyRange(parts: AssistantPart[]): { start: number; end: number } | null {
  let end = -1

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (isNonEmptyTextPart(parts[index])) {
      end = index
      break
    }
  }

  if (end === -1) {
    return null
  }

  let start = end
  while (start > 0 && isNonEmptyTextPart(parts[start - 1])) {
    start -= 1
  }

  while (end + 1 < parts.length && isSourcesPart(parts[end + 1])) {
    end += 1
  }

  return { start, end }
}

function buildSummary(processParts: AssistantPart[], hasContextMeta: boolean): AssistantProcessSummary {
  return processParts.reduce<AssistantProcessSummary>((summary, part) => {
    if (isToolCallPart(part)) {
      summary.toolCallCount += 1
    } else if (isReasoningPart(part)) {
      summary.hasReasoning = true
    } else if (isSearchPart(part)) {
      summary.hasSearch = true
    } else if (isSourcesPart(part)) {
      summary.hasSources = true
    } else if (isLintCheckPart(part)) {
      summary.hasLintCheck = true
    } else if (isSystemAlertPart(part)) {
      summary.hasSystemAlert = true
    } else if (isContextSnapshotPart(part)) {
      summary.hasContext = true
    } else if (isTextPart(part) && part.content.trim().length > 0) {
      summary.hasProcessText = true
    }

    return summary
  }, {
    toolCallCount: 0,
    hasReasoning: false,
    hasSearch: false,
    hasContext: hasContextMeta,
    hasSources: false,
    hasLintCheck: false,
    hasSystemAlert: false,
    hasProcessText: false,
  })
}

export function projectAssistantTurn(
  parts: AssistantPart[],
  options: AssistantTurnProjectionOptions = {},
): AssistantTurnProjection {
  const finalReplyRange = findFinalReplyRange(parts)
  const finalReplyParts = finalReplyRange
    ? parts.slice(finalReplyRange.start, finalReplyRange.end + 1)
    : []
  const processParts = parts.filter((_, index) => {
    if (!finalReplyRange) {
      return true
    }

    return index < finalReplyRange.start || index > finalReplyRange.end
  })
  const hasVisibleFinalReply = finalReplyParts.some(isNonEmptyTextPart)
  const hasProcessContent = processParts.length > 0 || !!options.hasContextMeta
  const isActiveTurn = !!options.isStreaming || !!options.isAwaitingApproval

  return {
    finalReplyParts,
    processParts,
    hasVisibleFinalReply,
    hasProcessContent,
    shouldCollapseProcess: hasProcessContent && !isActiveTurn && !options.expandProcessByDefault,
    summary: buildSummary(processParts, !!options.hasContextMeta),
  }
}
