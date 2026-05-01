/**
 * 统一缓存系统
 * 
 * 特性：
 * - 支持 main/renderer 进程
 * - LRU/LFU/FIFO 多种淘汰策略
 * - TTL + 滑动过期
 * - 内存限制 + 条目限制
 * - 分层缓存（L1 内存 + L2 可选持久化）
 * - 命名空间隔离
 * - 批量操作
 * - 统计和监控
 * - 事件订阅
 */

import { logger } from './Logger'

// ============================================
// 类型定义
// ============================================

/** 淘汰策略 */
export type EvictionPolicy = 'lru' | 'lfu' | 'fifo'

export type CacheCleanupPhase = 'manual' | 'workspace-switch' | 'shutdown' | 'deep'

export type CacheScope = 'session' | 'workspace' | 'app'

export interface CachePolicy {
  scope: CacheScope
  clearOn: CacheCleanupPhase[]
  persistent?: boolean
}

/** 缓存条目 */
interface CacheEntry<T> {
  value: T
  createdAt: number
  lastAccessed: number
  accessCount: number
  size: number
  ttl: number
  slidingExpiration: boolean
  tags: string[]
}

/** 缓存配置 */
export interface CacheConfig {
  /** 最大条目数 */
  maxSize: number
  /** 最大内存（字节） */
  maxMemory: number
  /** 默认 TTL（毫秒），0 表示永不过期 */
  defaultTTL: number
  /** 清理间隔（毫秒），0 禁用自动清理 */
  cleanupInterval: number
  /** 淘汰策略 */
  evictionPolicy: EvictionPolicy
  /** 是否启用滑动过期（访问时重置 TTL） */
  slidingExpiration: boolean
  /** 淘汰回调 */
  onEvict?: (key: string, value: unknown, reason: EvictReason) => void
  /** 是否启用统计 */
  enableStats: boolean
  policy?: CachePolicy
}

/** 淘汰原因 */
export type EvictReason = 'expired' | 'capacity' | 'memory' | 'manual' | 'tag'

/** 缓存统计 */
export interface CacheStats {
  name: string
  hits: number
  misses: number
  evictions: number
  size: number
  memoryUsage: number
  hitRate: number
  avgAccessTime: number
  oldestEntry: number
  newestEntry: number
}

/** 设置选项 */
export interface SetOptions {
  ttl?: number
  slidingExpiration?: boolean
  tags?: string[]
}

/** 缓存事件 */
export type CacheEvent = 'set' | 'get' | 'delete' | 'evict' | 'clear' | 'expire'
export type CacheEventHandler<T> = (event: CacheEvent, key: string, value?: T) => void

// ============================================
// 核心缓存类
// ============================================

export class CacheService<T = unknown> {
  private cache: Map<string, CacheEntry<T>> = new Map()
  private config: CacheConfig
  private stats: Omit<CacheStats, 'name' | 'hitRate' | 'avgAccessTime' | 'oldestEntry' | 'newestEntry'>
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private name: string
  private eventHandlers: Set<CacheEventHandler<T>> = new Set()
  private accessTimes: number[] = []

  constructor(name: string, config?: Partial<CacheConfig>) {
    this.name = name
    this.config = {
      maxSize: 1000,
      maxMemory: 50 * 1024 * 1024,
      defaultTTL: 5 * 60 * 1000,
      cleanupInterval: 60 * 1000,
      evictionPolicy: 'lru',
      slidingExpiration: false,
      enableStats: true,
      ...config,
    }

    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0,
      memoryUsage: 0,
    }

    if (this.config.cleanupInterval > 0) {
      this.startCleanup()
    }

    cacheManager.register(this, this.config.policy)
  }

  // ============================================
  // 基础操作
  // ============================================

  /** 获取缓存值 */
  get(key: string): T | undefined {
    const startTime = performance.now()
    const entry = this.cache.get(key)

    if (!entry) {
      this.stats.misses++
      this.recordAccessTime(startTime)
      return undefined
    }

    if (this.isExpired(entry)) {
      this.deleteInternal(key, 'expired')
      this.stats.misses++
      this.recordAccessTime(startTime)
      return undefined
    }

    // 更新访问信息
    entry.lastAccessed = Date.now()
    entry.accessCount++

    // 滑动过期：重置创建时间
    if (entry.slidingExpiration && entry.ttl > 0) {
      entry.createdAt = Date.now()
    }

    this.stats.hits++
    this.recordAccessTime(startTime)
    this.emit('get', key, entry.value)

    return entry.value
  }

  /** 设置缓存值 */
  set(key: string, value: T, options?: SetOptions): void {
    const size = this.estimateSize(value)
    const ttl = options?.ttl ?? this.config.defaultTTL
    const slidingExpiration = options?.slidingExpiration ?? this.config.slidingExpiration
    const tags = options?.tags ?? []

    // 确保容量
    this.ensureCapacity(size, key)

    const entry: CacheEntry<T> = {
      value,
      createdAt: Date.now(),
      lastAccessed: Date.now(),
      accessCount: 0,
      size,
      ttl,
      slidingExpiration,
      tags,
    }

    // 更新内存统计
    const existing = this.cache.get(key)
    if (existing) {
      this.stats.memoryUsage -= existing.size
    }

    this.cache.set(key, entry)
    this.stats.size = this.cache.size
    this.stats.memoryUsage += size

    this.emit('set', key, value)
  }

  /** 检查是否存在（不更新访问时间） */
  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false
    if (this.isExpired(entry)) {
      this.deleteInternal(key, 'expired')
      return false
    }
    return true
  }

  /** 删除缓存 */
  delete(key: string): boolean {
    return this.deleteInternal(key, 'manual')
  }

  /** 清空缓存 */
  clear(): void {
    this.cache.clear()
    this.stats.size = 0
    this.stats.memoryUsage = 0
    this.emit('clear', '*')
  }

  // ============================================
  // 高级操作
  // ============================================

  /** 获取或设置（异步工厂） */
  async getOrSet(key: string, factory: () => Promise<T>, options?: SetOptions): Promise<T> {
    const cached = this.get(key)
    if (cached !== undefined) {
      return cached
    }

    const value = await factory()
    this.set(key, value, options)
    return value
  }

  /** 获取或设置（同步工厂） */
  getOrSetSync(key: string, factory: () => T, options?: SetOptions): T {
    const cached = this.get(key)
    if (cached !== undefined) {
      return cached
    }

    const value = factory()
    this.set(key, value, options)
    return value
  }

  /** 批量获取 */
  getMany(keys: string[]): Map<string, T> {
    const result = new Map<string, T>()
    for (const key of keys) {
      const value = this.get(key)
      if (value !== undefined) {
        result.set(key, value)
      }
    }
    return result
  }

  /** 批量设置 */
  setMany(entries: Array<{ key: string; value: T; options?: SetOptions }>): void {
    for (const { key, value, options } of entries) {
      this.set(key, value, options)
    }
  }

  /** 批量删除 */
  deleteMany(keys: string[]): number {
    let count = 0
    for (const key of keys) {
      if (this.delete(key)) count++
    }
    return count
  }

  /** 按标签删除 */
  deleteByTag(tag: string): number {
    const keysToDelete: string[] = []
    for (const [key, entry] of this.cache) {
      if (entry.tags.includes(tag)) {
        keysToDelete.push(key)
      }
    }
    for (const key of keysToDelete) {
      this.deleteInternal(key, 'tag')
    }
    return keysToDelete.length
  }

  /** 按前缀删除 */
  deleteByPrefix(prefix: string): number {
    const keysToDelete: string[] = []
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key)
      }
    }
    return this.deleteMany(keysToDelete)
  }

  /** 按模式匹配键 */
  keys(pattern?: string | RegExp): string[] {
    const allKeys = Array.from(this.cache.keys())
    if (!pattern) return allKeys

    if (typeof pattern === 'string') {
      return allKeys.filter(k => k.includes(pattern))
    }
    return allKeys.filter(k => pattern.test(k))
  }

  /** 获取所有值 */
  values(): T[] {
    const result: T[] = []
    for (const key of this.cache.keys()) {
      const value = this.get(key)
      if (value !== undefined) {
        result.push(value)
      }
    }
    return result
  }

  /** 遍历（不更新访问时间） */
  forEach(callback: (value: T, key: string) => void): void {
    for (const [key, entry] of this.cache) {
      if (!this.isExpired(entry)) {
        callback(entry.value, key)
      }
    }
  }

  /** 更新值（保留元数据） */
  update(key: string, updater: (value: T) => T): boolean {
    const entry = this.cache.get(key)
    if (!entry || this.isExpired(entry)) return false

    const newValue = updater(entry.value)
    const newSize = this.estimateSize(newValue)

    this.stats.memoryUsage -= entry.size
    entry.value = newValue
    entry.size = newSize
    entry.lastAccessed = Date.now()
    this.stats.memoryUsage += newSize

    return true
  }

  /** 触摸（更新访问时间，延长 TTL） */
  touch(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry || this.isExpired(entry)) return false

    entry.lastAccessed = Date.now()
    if (entry.slidingExpiration && entry.ttl > 0) {
      entry.createdAt = Date.now()
    }
    return true
  }

  /** 获取剩余 TTL */
  ttl(key: string): number {
    const entry = this.cache.get(key)
    if (!entry) return -2 // 不存在
    if (entry.ttl === 0) return -1 // 永不过期

    const elapsed = Date.now() - entry.createdAt
    const remaining = entry.ttl - elapsed
    return remaining > 0 ? remaining : 0
  }

  // ============================================
  // 统计和监控
  // ============================================

  /** 获取统计信息 */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses
    const hitRate = total > 0 ? Math.round((this.stats.hits / total) * 100) : 0
    const avgAccessTime = this.accessTimes.length > 0
      ? this.accessTimes.reduce((a, b) => a + b, 0) / this.accessTimes.length
      : 0

    let oldestEntry = Date.now()
    let newestEntry = 0
    for (const entry of this.cache.values()) {
      if (entry.createdAt < oldestEntry) oldestEntry = entry.createdAt
      if (entry.createdAt > newestEntry) newestEntry = entry.createdAt
    }

    return {
      name: this.name,
      ...this.stats,
      hitRate,
      avgAccessTime: Math.round(avgAccessTime * 100) / 100,
      oldestEntry: this.cache.size > 0 ? oldestEntry : 0,
      newestEntry,
    }
  }

  /** 重置统计 */
  resetStats(): void {
    this.stats.hits = 0
    this.stats.misses = 0
    this.stats.evictions = 0
    this.accessTimes = []
  }

  /** 订阅事件 */
  on(handler: CacheEventHandler<T>): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  /** 销毁缓存 */
  destroy(): void {
    this.stopCleanup()
    this.clear()
    this.eventHandlers.clear()
    cacheManager.unregister(this.name)
  }

  // ============================================
  // 私有方法
  // ============================================

  private deleteInternal(key: string, reason: EvictReason): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false

    this.cache.delete(key)
    this.stats.size = this.cache.size
    this.stats.memoryUsage -= entry.size

    if (reason !== 'manual') {
      this.stats.evictions++
    }

    this.config.onEvict?.(key, entry.value, reason)
    this.emit(reason === 'expired' ? 'expire' : reason === 'manual' ? 'delete' : 'evict', key)

    return true
  }

  private isExpired(entry: CacheEntry<T>): boolean {
    if (entry.ttl === 0) return false
    return Date.now() - entry.createdAt > entry.ttl
  }

  private estimateSize(value: T): number {
    try {
      const str = JSON.stringify(value)
      return str.length * 2
    } catch {
      return 1024
    }
  }

  private ensureCapacity(newSize: number, excludeKey?: string): void {
    // 条目数量限制
    while (this.cache.size >= this.config.maxSize) {
      if (!this.evictOne(excludeKey)) break
    }

    // 内存限制
    while (this.stats.memoryUsage + newSize > this.config.maxMemory && this.cache.size > 0) {
      if (!this.evictOne(excludeKey)) break
    }
  }

  private evictOne(excludeKey?: string): boolean {
    const keyToEvict = this.selectEvictionCandidate(excludeKey)
    if (!keyToEvict) return false

    const reason: EvictReason = this.stats.memoryUsage > this.config.maxMemory ? 'memory' : 'capacity'
    return this.deleteInternal(keyToEvict, reason)
  }

  private selectEvictionCandidate(excludeKey?: string): string | null {
    let candidateKey: string | null = null
    let candidateScore = Infinity

    for (const [key, entry] of this.cache) {
      if (key === excludeKey) continue

      let score: number
      switch (this.config.evictionPolicy) {
        case 'lru':
          score = entry.lastAccessed
          break
        case 'lfu':
          score = entry.accessCount
          break
        case 'fifo':
          score = entry.createdAt
          break
      }

      if (score < candidateScore) {
        candidateScore = score
        candidateKey = key
      }
    }

    return candidateKey
  }

  private recordAccessTime(startTime: number): void {
    if (!this.config.enableStats) return
    const elapsed = performance.now() - startTime
    this.accessTimes.push(elapsed)
    if (this.accessTimes.length > 1000) {
      this.accessTimes = this.accessTimes.slice(-500)
    }
  }

  private emit(event: CacheEvent, key: string, value?: T): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event, key, value)
      } catch (e) {
        logger.cache.error(`[${this.name}] Event handler error:`, e)
      }
    }
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup()
    }, this.config.cleanupInterval)
  }

  private stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  private cleanup(): void {
    const expiredKeys: string[] = []
    for (const [key, entry] of this.cache) {
      if (this.isExpired(entry)) {
        expiredKeys.push(key)
      }
    }

    for (const key of expiredKeys) {
      this.deleteInternal(key, 'expired')
    }

    if (expiredKeys.length > 0) {
      logger.cache.debug(`[${this.name}] Cleanup: ${expiredKeys.length} expired`)
    }
  }
}


// ============================================
// 缓存管理器（全局注册和监控）
// ============================================

class CacheManager {
  private caches = new Map<string, CacheService<unknown>>()
  private policies = new Map<string, CachePolicy>()
  private cleanupHooks = new Map<string, { phases: CacheCleanupPhase[]; handler: () => void | Promise<void> }>()
  private static instance: CacheManager

  static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager()
    }
    return CacheManager.instance
  }

  /** 注册缓存实例 */
  register<T>(cache: CacheService<T>, policy?: CachePolicy): void {
    const stats = cache.getStats()
    this.caches.set(stats.name, cache as CacheService<unknown>)
    this.policies.set(stats.name, policy || inferCachePolicy(stats.name))
  }

  /** 注销缓存实例 */
  unregister(name: string): void {
    this.caches.delete(name)
    this.policies.delete(name)
    this.cleanupHooks.delete(name)
  }

  /** 获取缓存实例 */
  get<T>(name: string): CacheService<T> | undefined {
    return this.caches.get(name) as CacheService<T> | undefined
  }

  /** 获取所有缓存统计 */
  getAllStats(): CacheStats[] {
    return Array.from(this.caches.values()).map(c => c.getStats())
  }

  /** 获取总体统计 */
  getSummary(): {
    totalCaches: number
    totalSize: number
    totalMemory: number
    totalHits: number
    totalMisses: number
    overallHitRate: number
  } {
    const stats = this.getAllStats()
    const totalHits = stats.reduce((sum, s) => sum + s.hits, 0)
    const totalMisses = stats.reduce((sum, s) => sum + s.misses, 0)
    const total = totalHits + totalMisses

    return {
      totalCaches: stats.length,
      totalSize: stats.reduce((sum, s) => sum + s.size, 0),
      totalMemory: stats.reduce((sum, s) => sum + s.memoryUsage, 0),
      totalHits,
      totalMisses,
      overallHitRate: total > 0 ? Math.round((totalHits / total) * 100) : 0,
    }
  }

  /** 清空所有缓存 */
  clearAll(): void {
    for (const cache of this.caches.values()) {
      cache.clear()
    }
  }

  registerCleanupHook(name: string, phases: CacheCleanupPhase[], handler: () => void | Promise<void>): void {
    this.cleanupHooks.set(name, { phases, handler })
  }

  unregisterCleanupHook(name: string): void {
    this.cleanupHooks.delete(name)
  }

  async runPhase(phase: CacheCleanupPhase): Promise<void> {
    for (const [name, cache] of this.caches) {
      const policy = this.policies.get(name)
      if (!policy) continue
      if (phase === 'deep' || policy.clearOn.includes(phase)) {
        cache.clear()
      }
    }

    for (const { phases, handler } of this.cleanupHooks.values()) {
      if (phase === 'deep' || phases.includes(phase)) {
        await handler()
      }
    }
  }

  /** 销毁所有缓存 */
  destroyAll(): void {
    for (const cache of this.caches.values()) {
      cache.destroy()
    }
    this.caches.clear()
  }

  /** 按标签清除所有缓存 */
  clearByTag(tag: string): number {
    let total = 0
    for (const cache of this.caches.values()) {
      total += cache.deleteByTag(tag)
    }
    return total
  }
}

export const cacheManager = CacheManager.getInstance()

// ============================================
// 工厂函数（带自动注册）
// ============================================

/** 创建缓存实例并自动注册到管理器 */
export function createCache<T>(name: string, config?: Partial<CacheConfig>): CacheService<T> {
  return new CacheService<T>(name, config)
}

// ============================================
// 预配置缓存工厂（使用 agentConfig）
// ============================================

import { getCacheConfig, type CacheConfigs } from '../config/agentConfig'

/** 根据预定义类型创建缓存 */
export function createTypedCache<T>(
  type: keyof CacheConfigs,
  nameOverride?: string
): CacheService<T> {
  const config = getCacheConfig(type)
  const name = nameOverride || type.charAt(0).toUpperCase() + type.slice(1) + 'Cache'
  const policy = inferCachePolicy(name, type)
  
  return createCache<T>(name, {
    maxSize: config.maxSize,
    defaultTTL: config.ttlMs,
    maxMemory: config.maxMemory || 50 * 1024 * 1024,
    policy,
  })
}

function inferCachePolicy(name: string, type?: keyof CacheConfigs): CachePolicy {
  const key = `${name} ${type || ''}`.toLowerCase()
  const base: CacheCleanupPhase[] = ['manual', 'workspace-switch', 'shutdown']

  if (key.includes('llmprovider')) {
    return { scope: 'app', clearOn: ['shutdown', 'deep'], persistent: true }
  }

  if (key.includes('lspdiagnostics')) {
    return { scope: 'workspace', clearOn: ['workspace-switch', 'shutdown', 'deep'] }
  }

  if (
    key.includes('directory') ||
    key.includes('completion') ||
    key.includes('lint') ||
    key.includes('healthcheck') ||
    key.includes('filecontent') ||
    key.includes('searchresult') ||
    key.includes('agentfilecache') ||
    key.includes('contextfilecache') ||
    key.includes('contextsearchcache')
  ) {
    return { scope: 'workspace', clearOn: base }
  }

  return { scope: 'session', clearOn: base }
}

// ============================================
// 便捷导出
// ============================================

export default CacheService
