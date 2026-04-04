/**
 * 工作模式类型定义（共享）
 */

/** 工作模式 */
export type WorkMode = 'chat' | 'agent' | 'plan'

/**
 * Mode alias mapping for backward compatibility
 * 'orchestrator' is the old internal name, now aliased to 'plan'
 */
export type ModeAlias = 'orchestrator'

/**
 * Normalize mode name (resolve aliases)
 */
export function normalizeMode(mode: WorkMode | ModeAlias): WorkMode {
  if (mode === 'orchestrator') return 'plan'
  return mode as WorkMode
}
