/**
 * 工作模式类型定义（共享）
 */

/** 用户可选择的工作模式。Chat 已合并进 Agent，不再作为独立运行形态。 */
export type WorkMode = 'agent' | 'plan'

export const USER_WORK_MODES: readonly WorkMode[] = ['agent', 'plan']

/**
 * 规范化工作模式名称。
 * 这里仅接受当前有效模式，避免历史别名继续扩散成第二数据来源。
 */
export function normalizeMode(mode: unknown): WorkMode {
  return mode === 'plan' ? 'plan' : 'agent'
}
