import type { AssistantPart } from '@renderer/agent/types'
import { isReasoningPart, isSearchPart, isSystemAlertPart, isTextPart, isToolCallPart, isLintCheckPart, isContextSnapshotPart, isSourcesPart } from '@renderer/agent/types'

export interface AssistantTurnProjectionOptions {
  hasContextMeta?: boolean
}

export interface AssistantProcessSummary {
  toolCallCount: number
  hasReasoning: boolean
  hasSearch: boolean
  hasContext: boolean
  hasSources: boolean
  hasLintCheck: boolean
  hasProcessText: boolean
}

export interface AssistantTurnProjection {
  finalReplyParts: AssistantPart[]
  alertParts: AssistantPart[]
  processParts: AssistantPart[]
  hasProcessContent: boolean
  summary: AssistantProcessSummary
}

function isNonEmptyTextPart(part: AssistantPart): boolean {
  return isTextPart(part) && part.content.trim().length > 0
}

function findFinalReplyRange(parts: AssistantPart[]): { start: number; end: number } | null {
  let textEnd = parts.length - 1
  while (textEnd >= 0 && isSourcesPart(parts[textEnd])) textEnd -= 1
  if (textEnd < 0 || !isNonEmptyTextPart(parts[textEnd])) return null

  let start = textEnd
  while (start > 0 && isNonEmptyTextPart(parts[start - 1])) {
    start -= 1
  }

  return { start, end: parts.length - 1 }
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
    hasProcessText: false,
  })
}

export function projectAssistantTurn(
  parts: AssistantPart[],
  options: AssistantTurnProjectionOptions = {},
): AssistantTurnProjection {
  const alertParts = parts.filter(isSystemAlertPart)
  const nonAlertParts = parts.filter(part => !isSystemAlertPart(part))
  const finalReplyRange = findFinalReplyRange(nonAlertParts)
  const finalReplyParts = finalReplyRange
    ? nonAlertParts.slice(finalReplyRange.start, finalReplyRange.end + 1)
    : []
  const processParts = nonAlertParts.filter((_, index) => {
    if (!finalReplyRange) {
      return true
    }

    return index < finalReplyRange.start || index > finalReplyRange.end
  })
  const hasProcessContent = processParts.length > 0 || !!options.hasContextMeta

  return {
    finalReplyParts,
    alertParts,
    processParts,
    hasProcessContent,
    summary: buildSummary(processParts, !!options.hasContextMeta),
  }
}
