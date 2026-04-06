/**
 * Mode Registry - Central registry for mode descriptors
 *
 * Provides:
 * - Mode descriptor lookup
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

  constructor() {
    // Register default descriptors
    this.register(CHAT_MODE_DESCRIPTOR)
    this.register(AGENT_MODE_DESCRIPTOR)
    this.register(PLAN_MODE_DESCRIPTOR)

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
   */
  get(mode: WorkMode | string): ModeDescriptor | undefined {
    return this.descriptors.get(mode as WorkMode)
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
    return this.descriptors.has(mode as WorkMode)
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
   * 规范化模式名称。
   * 当前 registry 只接受正式模式名，不再维护历史别名映射。
   */
  normalize(mode: WorkMode | string): WorkMode {
    return mode as WorkMode
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

}

// Export singleton
export const modeRegistry = new ModeRegistry()
