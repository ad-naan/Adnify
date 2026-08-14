/**
 * SubAgent 编排模块
 *
 * 暴露 SubAgentManager 供主 agent 循环动态派生子代理。
 * 配合 task 工具（见 tools/providers/SubAgentToolProvider）使用。
 */

export { SubAgentManager } from './SubAgentManager'
export type { SubAgentLifecycleCallbacks, SubAgentRequest, SubAgentResult, SubAgentStartedInfo, SubAgentStatus } from './types'
