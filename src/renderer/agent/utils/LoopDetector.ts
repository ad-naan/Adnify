/**
 * Smarter loop detection for agent tool calls.
 *
 * Goals:
 * 1. Detect genuinely stuck behavior instead of just counting calls.
 * 2. Respect runtime configuration as the single threshold source.
 * 3. Treat "too many calls to the same tool" as a warning, not a hard stop.
 */

import { logger } from '@utils/Logger'
import type { LLMToolCall } from '@/shared/types'
import { getAgentConfig } from './AgentConfig'

interface ToolCallRecord {
  name: string
  target: string | null
  argsHash: string
  contentHash?: string
  timestamp: number
  success: boolean
}

export interface LoopCheckResult {
  isLoop: boolean
  reason?: string
  suggestion?: string
  warning?: string
}

interface LoopDetectorInternalConfig {
  timeWindowMs: number
  maxExactRepeats: number
  maxNoChangeEdits: number
  maxSameToolCallsWarning: number
  maxHistory: number
  minPatternLength: number
  maxPatternLength: number
  readOpMultiplier: number
  dynamicThreshold: boolean
}

function getLoopConfig(): LoopDetectorInternalConfig {
  const agentConfig = getAgentConfig()
  const loopConfig = agentConfig.loopDetection

  return {
    timeWindowMs: 3 * 60 * 1000,
    maxExactRepeats: loopConfig.maxExactRepeats,
    maxNoChangeEdits: loopConfig.maxSameTargetRepeats,
    maxSameToolCallsWarning: Math.max(
      agentConfig.maxToolLoops,
      loopConfig.maxSameTargetRepeats * 3,
      loopConfig.maxExactRepeats * 5
    ),
    maxHistory: loopConfig.maxHistory,
    minPatternLength: 2,
    maxPatternLength: 4,
    readOpMultiplier: 8,
    dynamicThreshold: loopConfig.dynamicThreshold ?? true,
  }
}

const READ_OPERATIONS = new Set([
  'read_file',
  'read_multiple_files',
  'list_directory',
  'get_dir_tree',
  'search_files',
  'grep_search',
  'codebase_search',
  'find_references',
  'go_to_definition',
  'get_hover_info',
  'get_document_symbols',
  'get_file_info',
])

const WRITE_OPERATIONS = new Set([
  'edit_file',
  'write_file',
  'replace_file_content',
  'create_file_or_folder',
  'delete_file_or_folder',
  'run_command',
])

export class LoopDetector {
  private history: ToolCallRecord[] = []
  private contentHashes: Map<string, string[]> = new Map()

  private get config(): LoopDetectorInternalConfig {
    return getLoopConfig()
  }

  checkLoop(
    toolCalls: LLMToolCall[],
    fileContents?: Map<string, string>
  ): LoopCheckResult {
    const now = Date.now()
    this.cleanupOldRecords(now)

    for (const tc of toolCalls) {
      const record = this.createRecord(tc, fileContents)

      const exactResult = this.checkExactRepeat(record)
      if (exactResult.isLoop || exactResult.warning) {
        return exactResult
      }

      if (WRITE_OPERATIONS.has(tc.name) && record.target) {
        const contentResult = this.checkContentChange(record)
        if (contentResult.isLoop) {
          return contentResult
        }
      }

      const patternResult = this.checkPatternLoop(record)
      if (patternResult.isLoop) {
        return patternResult
      }

      this.history.push(record)
    }

    return { isLoop: false }
  }

  recordResult(toolCallId: string, success: boolean): void {
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].argsHash.includes(toolCallId.slice(0, 8))) {
        this.history[i].success = success
        break
      }
    }
  }

  updateContentHash(filePath: string, content: string): void {
    const hash = this.hashContent(content)
    const hashes = this.contentHashes.get(filePath) || []
    hashes.push(hash)
    if (hashes.length > 10) {
      hashes.shift()
    }
    this.contentHashes.set(filePath, hashes)
  }

  reset(): void {
    this.history = []
    this.contentHashes.clear()
  }

  private createRecord(tc: LLMToolCall, fileContents?: Map<string, string>): ToolCallRecord {
    const args = (tc.arguments || {}) as Record<string, unknown>
    const rawTarget = args.path || args.file || args.command || args.query || null
    const target = typeof rawTarget === 'string' ? rawTarget : null

    let contentHash: string | undefined
    if (target && fileContents?.has(target)) {
      contentHash = this.hashContent(fileContents.get(target)!)
    }

    return {
      name: tc.name,
      target,
      argsHash: this.hashArgs(tc.arguments),
      contentHash,
      timestamp: Date.now(),
      success: true,
    }
  }

  private cleanupOldRecords(now: number): void {
    const cutoff = now - this.config.timeWindowMs
    this.history = this.history.filter(record => record.timestamp > cutoff)

    if (this.history.length > this.config.maxHistory) {
      this.history = this.history.slice(-this.config.maxHistory)
    }
  }

  private checkExactRepeat(record: ToolCallRecord): LoopCheckResult {
    const isReadOp = READ_OPERATIONS.has(record.name)
    const config = this.config

    let threshold = isReadOp
      ? config.maxExactRepeats * config.readOpMultiplier
      : config.maxExactRepeats

    if (config.dynamicThreshold) {
      const complexity = this.estimateTaskComplexity()
      if (complexity > 0.7) {
        threshold = Math.floor(threshold * 1.5)
        logger.agent.info(
          `[LoopDetector] Dynamic threshold adjusted: ${threshold} (complexity: ${complexity.toFixed(2)})`
        )
      }
    }

    const exactMatches = this.history.filter(
      entry => entry.name === record.name && entry.argsHash === record.argsHash
    )

    if (exactMatches.length >= threshold) {
      return {
        isLoop: true,
        reason: `Detected exact repeat of ${record.name} (${exactMatches.length + 1} times with identical arguments).`,
        suggestion: isReadOp
          ? 'The file content may not have changed. Consider a different approach.'
          : 'The same operation has been attempted multiple times. Please try a different approach.',
      }
    }

    const sameToolCalls = this.history.filter(entry => entry.name === record.name)
    if (sameToolCalls.length === config.maxSameToolCallsWarning) {
      return {
        isLoop: false,
        warning: `Tool "${record.name}" has been called ${sameToolCalls.length + 1} times. This may indicate a loop.`,
        suggestion: 'Consider whether a different tool or a broader batch operation would make better progress.',
      }
    }

    return { isLoop: false }
  }

  private checkContentChange(record: ToolCallRecord): LoopCheckResult {
    if (!record.target) {
      return { isLoop: false }
    }

    const hashes = this.contentHashes.get(record.target) || []
    if (hashes.length < 2) {
      return { isLoop: false }
    }

    const recentHashes = hashes.slice(-this.config.maxNoChangeEdits)
    const uniqueHashes = new Set(recentHashes)

    if (recentHashes.length >= this.config.maxNoChangeEdits && uniqueHashes.size <= 2) {
      return {
        isLoop: true,
        reason: `File "${record.target}" content is cycling between ${uniqueHashes.size} state(s) after ${recentHashes.length} edits.`,
        suggestion: 'The edits are not making progress. Consider reviewing the approach or asking for clarification.',
      }
    }

    return { isLoop: false }
  }

  private checkPatternLoop(newRecord: ToolCallRecord): LoopCheckResult {
    const tempHistory = [...this.history, newRecord]

    for (let len = this.config.minPatternLength; len <= this.config.maxPatternLength; len++) {
      if (tempHistory.length < len * 2) {
        continue
      }

      const recent = tempHistory.slice(-len * 2)
      const firstHalf = recent.slice(0, len)
      const secondHalf = recent.slice(len)

      const isExactPattern = firstHalf.every((recordItem, index) =>
        recordItem.name === secondHalf[index].name &&
        recordItem.argsHash === secondHalf[index].argsHash
      )

      if (isExactPattern && !this.isPathExploration(firstHalf, secondHalf)) {
        const pattern = firstHalf.map(item => `${item.name}(${item.target || 'N/A'})`).join(' -> ')
        return {
          isLoop: true,
          reason: `Detected repeating pattern: ${pattern} (repeated 2 times).`,
          suggestion: 'The agent is stuck in a loop. Consider breaking the pattern with a different approach.',
        }
      }
    }

    return { isLoop: false }
  }

  private isPathExploration(firstHalf: ToolCallRecord[], secondHalf: ToolCallRecord[]): boolean {
    const allSameTool = firstHalf.every((record, index) => record.name === secondHalf[index].name)
    if (!allSameTool) {
      return false
    }

    const hasTargets = firstHalf.every((record, index) => record.target && secondHalf[index].target)
    if (!hasTargets) {
      return false
    }

    for (let i = 0; i < firstHalf.length; i++) {
      const path1 = firstHalf[i].target!
      const path2 = secondHalf[i].target!
      if (path1 !== path2 && this.isSubPath(path1, path2)) {
        return true
      }
    }

    return false
  }

  private isSubPath(path1: string, path2: string): boolean {
    const normalized1 = path1.replace(/\\/g, '/').toLowerCase()
    const normalized2 = path2.replace(/\\/g, '/').toLowerCase()
    return normalized1.startsWith(normalized2) || normalized2.startsWith(normalized1)
  }

  private hashArgs(args: Record<string, unknown>): string {
    const normalized = JSON.stringify(args, Object.keys(args).sort())
    return this.simpleHash(normalized)
  }

  private hashContent(content: string): string {
    return this.simpleHash(content)
  }

  private estimateTaskComplexity(): number {
    if (this.history.length < 5) {
      return 0
    }

    const uniqueTools = new Set(this.history.map(record => record.name)).size
    const toolDiversity = Math.min(uniqueTools / 10, 1)

    const uniqueTargets = new Set(
      this.history
        .filter(record => record.target)
        .map(record => record.target)
    ).size
    const targetDiversity = Math.min(uniqueTargets / 15, 1)

    const failureRate = this.history.filter(record => !record.success).length / this.history.length
    return toolDiversity * 0.4 + targetDiversity * 0.4 + failureRate * 0.2
  }

  private simpleHash(value: string): string {
    let hash = 0
    for (let i = 0; i < value.length; i++) {
      const char = value.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash |= 0
    }
    return hash.toString(36)
  }
}
