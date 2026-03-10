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

// JSON 工具函数
export {
  getByPath,
  setByPath,
  hasPath,
  joinJsonPath,
  cleanToolCallArgs,
  fixUnescapedNewlines,
  fixMalformedJson,
  safeParseJson,
  generateId,
} from './jsonUtils'

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