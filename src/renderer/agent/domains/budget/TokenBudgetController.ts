/**
 * Token Budget Controller - Unified token budget management
 *
 * Centralizes all budget-related decisions:
 * - Pre-send budget estimation and validation
 * - Post-send usage reconciliation
 * - Mode-specific budget policies
 * - Warning/summary/handoff threshold management
 *
 * Design principles:
 * - Single source of truth for budget decisions
 * - Mode-aware budget policies
 * - Clear separation between estimation and reconciliation
 * - Support for reserved budgets (output, safety margin)
 */

import { logger } from '@utils/Logger'
import type { WorkMode } from '@/shared/types/workMode'
import type { ModeDescriptor } from '../mode/ModeDescriptor'
import type { CompressionLevel } from '../context/CompressionManager'
import { calculateLevel, LEVEL_NAMES } from '../context/CompressionManager'

// ===== Budget Configuration =====

export interface BudgetConfig {
  /** Model context limit (total tokens) */
  contextLimit: number
  /** Target usage ratio (0-1) */
  targetRatio: number
  /** Reserved tokens for output */
  reservedOutputTokens: number
  /** Reserved tokens for safety margin */
  reservedSafetyTokens: number
  /** Initial compression level */
  initialCompressionLevel: CompressionLevel
  /** Enable auto-compression */
  enableAutoCompression: boolean
  /** Enable summary generation at L3 */
  enableSummaryGeneration: boolean
  /** Enable handoff generation at L4 */
  enableHandoffGeneration: boolean
}

// ===== Budget Estimate =====

export interface BudgetEstimate {
  /** Total estimated tokens (input) */
  totalTokens: number
  /** System prompt tokens */
  systemPromptTokens: number
  /** Message history tokens */
  historyTokens: number
  /** Context tokens (files, codebase search, etc.) */
  contextTokens: number
  /** Current user message tokens */
  userMessageTokens: number
  /** Reserved output tokens */
  reservedOutputTokens: number
  /** Reserved safety tokens */
  reservedSafetyTokens: number
  /** Usable budget for history */
  usableHistoryBudget: number
  /** Current usage ratio */
  usageRatio: number
  /** Recommended compression level */
  recommendedLevel: CompressionLevel
  /** Whether budget is exceeded */
  isExceeded: boolean
  /** Warning message (if any) */
  warning?: string
}

// ===== Budget Reconciliation =====

export interface BudgetReconciliation {
  /** Actual input tokens (from LLM) */
  actualInputTokens: number
  /** Actual output tokens (from LLM) */
  actualOutputTokens: number
  /** Estimated input tokens (pre-send) */
  estimatedInputTokens: number
  /** Estimation error (actual - estimated) */
  estimationError: number
  /** Estimation error percentage */
  estimationErrorPercent: number
  /** Actual usage ratio */
  actualUsageRatio: number
  /** Calculated compression level based on actual usage */
  calculatedLevel: CompressionLevel
  /** Whether summary should be generated */
  shouldGenerateSummary: boolean
  /** Whether handoff should be generated */
  shouldGenerateHandoff: boolean
  /** Whether context limit is reached */
  isLimitReached: boolean
}

// ===== Token Budget Controller =====

export class TokenBudgetController {
  private config: BudgetConfig
  private modeDescriptor: ModeDescriptor

  constructor(config: BudgetConfig, modeDescriptor: ModeDescriptor) {
    this.config = config
    this.modeDescriptor = modeDescriptor
  }

  /**
   * Estimate budget before sending to LLM
   */
  estimate(
    systemPromptTokens: number,
    historyTokens: number,
    contextTokens: number,
    userMessageTokens: number
  ): BudgetEstimate {
    const { contextLimit, targetRatio, reservedOutputTokens, reservedSafetyTokens } = this.config

    // Calculate total input tokens
    const totalTokens = systemPromptTokens + historyTokens + contextTokens + userMessageTokens

    // Calculate usable budget (excluding reserved tokens)
    const reservedTotal = reservedOutputTokens + reservedSafetyTokens
    const usableLimit = contextLimit - reservedTotal
    const usableHistoryBudget = usableLimit - systemPromptTokens - contextTokens - userMessageTokens

    // Calculate usage ratio
    const usageRatio = totalTokens / contextLimit

    // Determine recommended compression level
    const recommendedLevel = this.calculateRecommendedLevel(usageRatio, targetRatio)

    // Check if budget is exceeded
    const isExceeded = usageRatio > targetRatio

    // Generate warning if needed
    let warning: string | undefined
    if (isExceeded) {
      warning = `Budget exceeded: ${(usageRatio * 100).toFixed(1)}% > ${(targetRatio * 100).toFixed(1)}% target`
    } else if (usageRatio > 0.9) {
      warning = `Budget critical: ${(usageRatio * 100).toFixed(1)}% of context limit`
    } else if (usageRatio > 0.7) {
      warning = `Budget high: ${(usageRatio * 100).toFixed(1)}% of context limit`
    }

    const estimate: BudgetEstimate = {
      totalTokens,
      systemPromptTokens,
      historyTokens,
      contextTokens,
      userMessageTokens,
      reservedOutputTokens,
      reservedSafetyTokens,
      usableHistoryBudget,
      usageRatio,
      recommendedLevel,
      isExceeded,
      warning,
    }

    logger.agent.debug(
      `[BudgetController] Estimate: ${totalTokens}/${contextLimit} tokens (${(usageRatio * 100).toFixed(1)}%), ` +
      `recommended L${recommendedLevel}`
    )

    return estimate
  }

  /**
   * Reconcile budget after receiving LLM response
   */
  reconcile(
    actualInputTokens: number,
    actualOutputTokens: number,
    estimatedInputTokens: number
  ): BudgetReconciliation {
    const { contextLimit } = this.config

    // Calculate estimation error
    const estimationError = actualInputTokens - estimatedInputTokens
    const estimationErrorPercent = estimatedInputTokens > 0
      ? (estimationError / estimatedInputTokens) * 100
      : 0

    // Calculate actual usage ratio (only input tokens count toward context limit)
    const actualUsageRatio = actualInputTokens / contextLimit

    // Calculate compression level based on actual usage
    const calculatedLevel = calculateLevel(actualUsageRatio)

    // Determine if summary/handoff should be generated
    const shouldGenerateSummary = calculatedLevel >= 3 && this.config.enableSummaryGeneration
    const shouldGenerateHandoff = calculatedLevel >= 4 && this.config.enableHandoffGeneration
    const isLimitReached = calculatedLevel >= 4

    const reconciliation: BudgetReconciliation = {
      actualInputTokens,
      actualOutputTokens,
      estimatedInputTokens,
      estimationError,
      estimationErrorPercent,
      actualUsageRatio,
      calculatedLevel,
      shouldGenerateSummary,
      shouldGenerateHandoff,
      isLimitReached,
    }

    logger.agent.info(
      `[BudgetController] Reconciliation: ${actualInputTokens}/${contextLimit} tokens (${(actualUsageRatio * 100).toFixed(1)}%), ` +
      `L${calculatedLevel} (${LEVEL_NAMES[calculatedLevel]}), ` +
      `error: ${estimationError > 0 ? '+' : ''}${estimationError} (${estimationErrorPercent.toFixed(1)}%)`
    )

    if (shouldGenerateSummary) {
      logger.agent.info('[BudgetController] Summary generation recommended')
    }
    if (shouldGenerateHandoff) {
      logger.agent.warn('[BudgetController] Handoff generation required - context limit reached')
    }

    return reconciliation
  }

  /**
   * Calculate recommended compression level based on usage ratio
   */
  private calculateRecommendedLevel(usageRatio: number, targetRatio: number): CompressionLevel {
    // If we're already under target, use initial level
    if (usageRatio <= targetRatio) {
      return this.config.initialCompressionLevel
    }

    // Calculate how much we need to compress
    const excessRatio = usageRatio - targetRatio

    // Map excess ratio to compression level
    if (excessRatio < 0.05) return 1 // 5% over target
    if (excessRatio < 0.10) return 2 // 10% over target
    if (excessRatio < 0.15) return 3 // 15% over target
    return 4 // More than 15% over target
  }

  /**
   * Get budget thresholds for warnings
   */
  getThresholds() {
    const { contextLimit, targetRatio } = this.config

    return {
      targetTokens: Math.floor(contextLimit * targetRatio),
      warningTokens: Math.floor(contextLimit * 0.7),
      criticalTokens: Math.floor(contextLimit * 0.9),
      limitTokens: contextLimit,
      summaryThreshold: 0.85, // L3 threshold
      handoffThreshold: 0.95, // L4 threshold
    }
  }

  /**
   * Check if a specific threshold is crossed
   */
  checkThreshold(tokens: number, threshold: 'warning' | 'critical' | 'summary' | 'handoff' | 'limit'): boolean {
    const thresholds = this.getThresholds()
    const ratio = tokens / this.config.contextLimit

    switch (threshold) {
      case 'warning':
        return ratio >= 0.7
      case 'critical':
        return ratio >= 0.9
      case 'summary':
        return ratio >= 0.85
      case 'handoff':
        return ratio >= 0.95
      case 'limit':
        return tokens >= thresholds.limitTokens
    }
  }

  /**
   * Get remaining budget
   */
  getRemainingBudget(currentTokens: number): number {
    const { contextLimit, reservedOutputTokens, reservedSafetyTokens } = this.config
    const usableLimit = contextLimit - reservedOutputTokens - reservedSafetyTokens
    return Math.max(0, usableLimit - currentTokens)
  }

  /**
   * Estimate remaining turns based on current usage
   */
  estimateRemainingTurns(currentInputTokens: number, currentOutputTokens: number): number {
    const avgTurnTokens = currentInputTokens + currentOutputTokens
    if (avgTurnTokens === 0) return 0

    const remaining = this.getRemainingBudget(currentInputTokens)
    return Math.floor(remaining / avgTurnTokens)
  }

  /**
   * Update budget config (for mode switching)
   */
  updateConfig(config: Partial<BudgetConfig>): void {
    this.config = { ...this.config, ...config }
    logger.agent.debug('[BudgetController] Config updated')
  }

  /**
   * Update mode descriptor (for mode switching)
   */
  updateModeDescriptor(modeDescriptor: ModeDescriptor): void {
    this.modeDescriptor = modeDescriptor
    // Update config from mode descriptor's budget profile
    this.config = {
      ...this.config,
      targetRatio: modeDescriptor.budgetProfile.targetRatio,
      reservedOutputTokens: modeDescriptor.budgetProfile.reservedOutputTokens,
      reservedSafetyTokens: modeDescriptor.budgetProfile.reservedSafetyTokens,
      initialCompressionLevel: modeDescriptor.budgetProfile.initialCompressionLevel,
      enableAutoCompression: modeDescriptor.budgetProfile.enableAutoCompression,
      enableSummaryGeneration: modeDescriptor.budgetProfile.enableSummaryGeneration,
      enableHandoffGeneration: modeDescriptor.budgetProfile.enableHandoffGeneration,
    }
    logger.agent.debug(`[BudgetController] Mode descriptor updated: ${modeDescriptor.id}`)
  }

  /**
   * Get current config
   */
  getConfig(): BudgetConfig {
    return { ...this.config }
  }

  /**
   * Get current mode descriptor
   */
  getModeDescriptor(): ModeDescriptor {
    return this.modeDescriptor
  }
}

// ===== Factory =====

/**
 * Create a budget controller for a specific mode
 */
export function createBudgetController(
  _mode: WorkMode,
  modeDescriptor: ModeDescriptor,
  contextLimit: number = 128_000
): TokenBudgetController {
  const config: BudgetConfig = {
    contextLimit,
    targetRatio: modeDescriptor.budgetProfile.targetRatio,
    reservedOutputTokens: modeDescriptor.budgetProfile.reservedOutputTokens,
    reservedSafetyTokens: modeDescriptor.budgetProfile.reservedSafetyTokens,
    initialCompressionLevel: modeDescriptor.budgetProfile.initialCompressionLevel,
    enableAutoCompression: modeDescriptor.budgetProfile.enableAutoCompression,
    enableSummaryGeneration: modeDescriptor.budgetProfile.enableSummaryGeneration,
    enableHandoffGeneration: modeDescriptor.budgetProfile.enableHandoffGeneration,
  }

  return new TokenBudgetController(config, modeDescriptor)
}
