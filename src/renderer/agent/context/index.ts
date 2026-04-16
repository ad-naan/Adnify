/**
 * 上下文管理模块
 */

// 压缩管理器
export {
  prepareMessages,
  updateStats,
  estimateMessagesTokens,
  type CompressionStats,
  type PrepareResult,
} from '../domains/context/CompressionManager'
export {
  calculateLevel,
  LEVEL_NAMES,
  type CompressionLevel,
} from '../domains/context/compressionShared'

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
