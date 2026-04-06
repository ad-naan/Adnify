/**
 * 工作模式类型定义（共享）
 */

/** 工作模式 */
export type WorkMode = 'chat' | 'agent' | 'plan'

/**
 * 规范化工作模式名称。
 * 这里仅接受当前有效模式，避免历史别名继续扩散成第二数据来源。
 */
export function normalizeMode(mode: WorkMode): WorkMode {
  return mode
}
