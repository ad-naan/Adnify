/**
 * Mode Registry - Central registry for mode descriptors
 *
 * Provides:
 * - Mode descriptor lookup
 * - Mode compatibility layer (orchestrator -> plan)
 * - Mode validation
 */

import { logger } from '@utils/Logger'
import type { WorkMode } from '@/shared/types/workMode'
import type { ModeDescriptor } from './ModeDescriptor'
import {
  CHAT_MODE_DESCRIPTOR,
  AGENT_MODE_DESCRIPTOR,
  PLAN_MODE_DESCRIPTOR,
  PLAN_TASK_WORKER_DESCRIPTOR,
} from './ModeDescriptor'

export class ModeRegistry {
  private descriptors: Map<WorkMode, ModeDescriptor> = new Map()
  private aliases: Map<string, WorkMode> = new Map()

  constructor() {
    // Register default descriptors
    this.register(CHAT_MODE_DESCRIPTOR)
    this.register(AGENT_MODE_DESCRIPTOR)
    this.register(PLAN_MODE_DESCRIPTOR)

    // Register backward compatibility alias: 'orchestrator' -> 'plan'
    this.aliases.set('orchestrator', 'plan')

    logger.agent.info('[ModeRegistry] Initialized with 3 modes')
  }

  /**
   * Register a mode descriptor
   */
  register(descriptor: ModeDescriptor): void {
    this.descriptors.set(descriptor.id, descriptor)
    logger.agent.debug(`[ModeRegistry] Registered mode: ${descriptor.id}`)
  }

  /**
   * Get mode descriptor by ID
   * Supports aliases (e.g., 'orchestrator' -> 'plan')
   */
  get(mode: WorkMode | string): ModeDescriptor | undefined {
    // Check if it's an alias
    const resolvedMode = this.aliases.get(mode) || (mode as WorkMode)
    return this.descriptors.get(resolvedMode)
  }

  /**
   * Get mode descriptor with fallback to agent mode
   */
  getOrDefault(mode: WorkMode | string): ModeDescriptor {
    const descriptor = this.get(mode)
    if (!descriptor) {
      logger.agent.warn(`[ModeRegistry] Unknown mode: ${mode}, falling back to agent`)
      return AGENT_MODE_DESCRIPTOR
    }
    return descriptor
  }

  /**
   * Check if a mode is registered
   */
  has(mode: WorkMode | string): boolean {
    const resolvedMode = this.aliases.get(mode) || (mode as WorkMode)
    return this.descriptors.has(resolvedMode)
  }

  /**
   * Get all registered modes
   */
  getAllModes(): WorkMode[] {
    return Array.from(this.descriptors.keys())
  }

  /**
   * Get all mode descriptors
   */
  getAllDescriptors(): ModeDescriptor[] {
    return Array.from(this.descriptors.values())
  }

  /**
   * Normalize mode name (resolve aliases)
   */
  normalize(mode: WorkMode | string): WorkMode {
    return this.aliases.get(mode) || (mode as WorkMode)
  }

  /**
   * Get plan task worker descriptor (internal use)
   */
  getPlanTaskWorkerDescriptor(): ModeDescriptor {
    return PLAN_TASK_WORKER_DESCRIPTOR
  }

  /**
   * Check if a mode allows tools
   */
  isToolsEnabled(mode: WorkMode | string): boolean {
    const descriptor = this.get(mode)
    return descriptor?.toolPolicy.enabled ?? false
  }

  /**
   * Check if a mode requires approval for tools
   */
  requiresToolApproval(mode: WorkMode | string): boolean {
    const descriptor = this.get(mode)
    return descriptor?.toolPolicy.requireApproval ?? true
  }

  /**
   * Get allowed tools for a mode
   */
  getAllowedTools(mode: WorkMode | string): string[] | undefined {
    const descriptor = this.get(mode)
    return descriptor?.toolPolicy.allowlist
  }

  /**
   * Get blocked tools for a mode
   */
  getBlockedTools(mode: WorkMode | string): string[] | undefined {
    const descriptor = this.get(mode)
    return descriptor?.toolPolicy.blocklist
  }

  /**
   * Check if a tool is allowed in a mode
   */
  isToolAllowed(mode: WorkMode | string, toolName: string): boolean {
    const descriptor = this.get(mode)
    if (!descriptor || !descriptor.toolPolicy.enabled) {
      return false
    }

    const { allowlist, blocklist } = descriptor.toolPolicy

    // Check blocklist first
    if (blocklist && blocklist.includes(toolName)) {
      return false
    }

    // If allowlist exists, tool must be in it
    if (allowlist && allowlist.length > 0) {
      return allowlist.includes(toolName)
    }

    // No allowlist = all tools allowed (except blocked)
    return true
  }
}

// Export singleton
export const modeRegistry = new ModeRegistry()
