/**
 * 上下文管理模块
 */

// 压缩管理器
export {
  prepareMessages,
  updateStats,
  calculateLevel,
  estimateMessagesTokens,
  LEVEL_NAMES,
  type CompressionLevel,
  type CompressionStats,
  type PrepareResult,
} from '../domains/context/CompressionManager'

// 摘要服务
export {
  generateSummary,
  generateHandoffDocument,
  type SummaryResult,
} from '../domains/context/summaryService'

// Handoff 管理
export { buildHandoffContext, buildWelcomeMessage } from '../domains/context/HandoffManager'

// 类型
export type {
  StructuredSummary,
  HandoffDocument,
  FileChangeRecord,
} from '../domains/context/types'
