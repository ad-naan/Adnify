/**
 * 共享工具函数导出
 */

export { logger, type LogLevel, type LogCategory, type LogEntry } from './Logger'

// 路径工具函数
export {
  normalizePath,
  pathEquals,
  pathStartsWith,
  getBasename,
  getFileName,
  getDirname,
  getDirPath,
  getExtension,
  getPathSeparator,
  joinPaths,
  joinPath,
  toFullPath,
  toRelativePath,
  pathMatches,
  resolveImportPath,
  isPathInWorkspace,
  validatePath,
  hasPathTraversal,
  isSensitivePath,
} from './pathUtils'

// JSON 扫描（流式工具调用参数天然是不完整 JSON，收口在这一份）
export {
  scanJson,
  findJsonValueEnd,
  sliceJsonValue,
  closeUnterminatedJson,
  type JsonScanResult,
  type JsonOpenBracket,
} from './jsonScan'

// 性能监控
export {
  performanceMonitor,
  type PerformanceMetric,
  type MetricCategory,
  type MemorySnapshot,
} from './PerformanceMonitor'

// 缓存服务
export {
  CacheService,
  cacheManager,
  createCache,
  createTypedCache,
  type CacheConfig,
  type CacheStats,
  type EvictionPolicy,
  type CacheCleanupPhase,
  type CacheScope,
  type CachePolicy,
  type SetOptions,
  type CacheEvent,
} from './CacheService'

// 重试工具
export {
  withRetry,
  withTimeout,
  sleep,
  cancellable,
  isRetryableError,
  type RetryConfig,
} from './retry'

// 日期工具
export {
  getRelativeTime,
} from './dateUtils'

// 防抖与节流
export {
  debounce,
  throttle
} from './debounce'
