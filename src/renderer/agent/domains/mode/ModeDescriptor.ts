/**
 * Mode Descriptor - Unified mode capability description
 *
 * Defines how each mode (chat/agent/plan) behaves in terms of:
 * - Tool policy
 * - Prompt profile
 * - Context profile
 * - Budget profile
 * - Persistence profile
 */

import type { WorkMode } from '@/shared/types/workMode'
import type { CompressionLevel } from '../context/CompressionManager'

// ===== Tool Policy =====

export interface ToolPolicy {
  /** Whether tools are enabled */
  enabled: boolean
  /** Tool allowlist (empty = all allowed) */
  allowlist?: string[]
  /** Tool blocklist */
  blocklist?: string[]
  /** Whether to require approval for dangerous tools */
  requireApproval?: boolean
}

// ===== Prompt Profile =====

export interface PromptProfile {
  /** Base system prompt template */
  baseTemplate?: string
  /** Whether to inject workspace context */
  includeWorkspaceContext: boolean
  /** Whether to inject open files context */
  includeOpenFiles: boolean
  /** Whether to inject active file context */
  includeActiveFile: boolean
  /** Whether to inject custom instructions */
  includeCustomInstructions: boolean
  /** Additional prompt sections */
  additionalSections?: string[]
}

// ===== Context Profile =====

export interface ContextProfile {
  /** Whether to include full message history */
  includeFullHistory: boolean
  /** Whether to include tool call history */
  includeToolHistory: boolean
  /** Whether to include summary/handoff context */
  includeSummaryContext: boolean
  /** Whether to include plan-specific context */
  includePlanContext: boolean
  /** Maximum context items to include */
  maxContextItems?: number
  /** Context priority order */
  contextPriority?: ('history' | 'tools' | 'summary' | 'plan' | 'dependencies')[]
}

// ===== Budget Profile =====

export interface BudgetProfile {
  /** Target context usage ratio (0-1) */
  targetRatio: number
  /** Reserved output token budget */
  reservedOutputTokens: number
  /** Reserved safety margin tokens */
  reservedSafetyTokens: number
  /** Initial compression level */
  initialCompressionLevel: CompressionLevel
  /** Whether to enable auto-compression */
  enableAutoCompression: boolean
  /** Whether to enable summary generation at L3 */
  enableSummaryGeneration: boolean
  /** Whether to enable handoff generation at L4 */
  enableHandoffGeneration: boolean
}

// ===== Persistence Profile =====

export interface PersistenceProfile {
  /** Whether to persist thread state */
  persistThread: boolean
  /** Whether to persist messages */
  persistMessages: boolean
  /** Whether to persist context items */
  persistContextItems: boolean
  /** Whether to persist compression stats */
  persistCompressionStats: boolean
  /** Whether to persist summary */
  persistSummary: boolean
  /** Whether to restore on startup */
  restoreOnStartup: boolean
}

// ===== Mode Descriptor =====

export interface ModeDescriptor {
  /** Mode identifier */
  id: WorkMode
  /** Display name */
  displayName: string
  /** Description */
  description: string
  /** Tool policy */
  toolPolicy: ToolPolicy
  /** Prompt profile */
  promptProfile: PromptProfile
  /** Context profile */
  contextProfile: ContextProfile
  /** Budget profile */
  budgetProfile: BudgetProfile
  /** Persistence profile */
  persistenceProfile: PersistenceProfile
}

// ===== Default Descriptors =====

export const CHAT_MODE_DESCRIPTOR: ModeDescriptor = {
  id: 'chat',
  displayName: 'Chat',
  description: 'Quick Q&A without tool execution',
  toolPolicy: {
    enabled: false,
  },
  promptProfile: {
    includeWorkspaceContext: false,
    includeOpenFiles: false,
    includeActiveFile: false,
    includeCustomInstructions: true,
  },
  contextProfile: {
    includeFullHistory: true,
    includeToolHistory: false,
    includeSummaryContext: false,
    includePlanContext: false,
    maxContextItems: 5,
    contextPriority: ['history'],
  },
  budgetProfile: {
    targetRatio: 0.7,
    reservedOutputTokens: 4096,
    reservedSafetyTokens: 2048,
    initialCompressionLevel: 0,
    enableAutoCompression: true,
    enableSummaryGeneration: false,
    enableHandoffGeneration: false,
  },
  persistenceProfile: {
    persistThread: true,
    persistMessages: true,
    persistContextItems: true,
    persistCompressionStats: true,
    persistSummary: false,
    restoreOnStartup: true,
  },
}

export const AGENT_MODE_DESCRIPTOR: ModeDescriptor = {
  id: 'agent',
  displayName: 'Agent',
  description: 'Autonomous task execution with tools',
  toolPolicy: {
    enabled: true,
    requireApproval: true,
  },
  promptProfile: {
    includeWorkspaceContext: true,
    includeOpenFiles: true,
    includeActiveFile: true,
    includeCustomInstructions: true,
  },
  contextProfile: {
    includeFullHistory: true,
    includeToolHistory: true,
    includeSummaryContext: true,
    includePlanContext: false,
    contextPriority: ['summary', 'tools', 'history'],
  },
  budgetProfile: {
    targetRatio: 0.85,
    reservedOutputTokens: 8192,
    reservedSafetyTokens: 4096,
    initialCompressionLevel: 0,
    enableAutoCompression: true,
    enableSummaryGeneration: true,
    enableHandoffGeneration: true,
  },
  persistenceProfile: {
    persistThread: true,
    persistMessages: true,
    persistContextItems: true,
    persistCompressionStats: true,
    persistSummary: true,
    restoreOnStartup: true,
  },
}

export const PLAN_MODE_DESCRIPTOR: ModeDescriptor = {
  id: 'plan',
  displayName: 'Plan',
  description: 'Multi-step planning and task orchestration',
  toolPolicy: {
    enabled: true,
    requireApproval: true,
    // Plan mode has specific tools for planning
    allowlist: ['create_task_plan', 'update_task_plan', 'start_task_execution', 'ask_user'],
  },
  promptProfile: {
    includeWorkspaceContext: true,
    includeOpenFiles: true,
    includeActiveFile: true,
    includeCustomInstructions: true,
  },
  contextProfile: {
    includeFullHistory: true,
    includeToolHistory: true,
    includeSummaryContext: true,
    includePlanContext: true,
    contextPriority: ['plan', 'dependencies', 'summary', 'tools', 'history'],
  },
  budgetProfile: {
    targetRatio: 0.85,
    reservedOutputTokens: 8192,
    reservedSafetyTokens: 4096,
    initialCompressionLevel: 0,
    enableAutoCompression: true,
    enableSummaryGeneration: true,
    enableHandoffGeneration: true,
  },
  persistenceProfile: {
    persistThread: true,
    persistMessages: true,
    persistContextItems: true,
    persistCompressionStats: true,
    persistSummary: true,
    restoreOnStartup: true,
  },
}

// Plan task worker descriptor (internal, not user-facing)
export const PLAN_TASK_WORKER_DESCRIPTOR: ModeDescriptor = {
  id: 'agent', // Reuses agent execution kernel
  displayName: 'Plan Task Worker',
  description: 'Background worker for plan task execution',
  toolPolicy: {
    enabled: true,
    requireApproval: false, // Auto-approve for background tasks
  },
  promptProfile: {
    includeWorkspaceContext: true,
    includeOpenFiles: false,
    includeActiveFile: false,
    includeCustomInstructions: false,
  },
  contextProfile: {
    includeFullHistory: false, // Only task-specific context
    includeToolHistory: true,
    includeSummaryContext: false,
    includePlanContext: true,
    maxContextItems: 10,
    contextPriority: ['plan', 'dependencies', 'tools'],
  },
  budgetProfile: {
    targetRatio: 0.8,
    reservedOutputTokens: 4096,
    reservedSafetyTokens: 2048,
    initialCompressionLevel: 1, // Start with some compression
    enableAutoCompression: true,
    enableSummaryGeneration: false,
    enableHandoffGeneration: false,
  },
  persistenceProfile: {
    persistThread: false, // Worker threads are ephemeral
    persistMessages: false,
    persistContextItems: false,
    persistCompressionStats: false,
    persistSummary: false,
    restoreOnStartup: false,
  },
}
