/**
 * 内存泄漏检测单元测试
 *
 * 背景：旧实现只看相对增长率，把冷启动爬坡（几 MB → 数百 MB）报成
 * "9151% 泄漏"，既是误报，又让真正的信号（接近堆上限）被噪声淹没。
 * 这些用例锁定修复后的判定条件。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { performanceMonitor } from '@shared/utils/PerformanceMonitor'
import { logger } from '@shared/utils/Logger'
import type { MemorySnapshot } from '@shared/utils/PerformanceMonitor'

const MB = 1024 * 1024

// 检测逻辑是私有的，测试通过注入快照序列 + 直接调用私有方法来驱动，
// 避免依赖 30s 的真实定时器。
type MonitorInternals = {
  memorySnapshots: MemorySnapshot[]
  startedAt: number
  lastLeakWarningAt: number
  lastPressureWarningAt: number
  heapLimit: number | null | undefined
  detectMemoryLeak(): void
  detectMemoryPressure(snapshot: MemorySnapshot): void
}

function internals(): MonitorInternals {
  return performanceMonitor as unknown as MonitorInternals
}

/** 构造 10 个快照，堆从 fromMB 线性涨到 toMB，每个间隔 30s。 */
function seedSnapshots(fromMB: number, toMB: number, startTimestamp: number): void {
  const state = internals()
  const count = 10
  state.memorySnapshots = Array.from({ length: count }, (_, i) => {
    const heapUsed = (fromMB + ((toMB - fromMB) * i) / (count - 1)) * MB
    return {
      timestamp: startTimestamp + i * 30_000,
      heapUsed,
      heapTotal: heapUsed * 1.2,
      external: 0,
      rss: heapUsed * 1.5,
    }
  })
}

function lastTimestamp(): number {
  const snaps = internals().memorySnapshots
  return snaps[snaps.length - 1].timestamp
}

describe('PerformanceMonitor 内存诊断', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(logger.perf, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(logger.perf, 'error').mockImplementation(() => {})

    const state = internals()
    state.memorySnapshots = []
    // -Infinity = 从未告警；用 0 会被冷却窗口误判成「刚告警过」
    state.lastLeakWarningAt = Number.NEGATIVE_INFINITY
    state.lastPressureWarningAt = Number.NEGATIVE_INFINITY
    state.heapLimit = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
    internals().memorySnapshots = []
  })

  describe('detectMemoryLeak', () => {
    it('启动预热窗口内的堆爬坡不告警（回归：9151% 误报）', () => {
      const state = internals()
      state.startedAt = 0
      // 复刻真实日志：9MB → 851MB，发生在启动后约 270s
      seedSnapshots(9, 851, 1_000)

      state.detectMemoryLeak()

      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('预热期结束后的大幅持续增长仍会告警', () => {
      const state = internals()
      state.startedAt = 0
      // 预热窗口是 5 分钟，这里让快照落在启动 30 分钟后
      seedSnapshots(300, 900, 30 * 60 * 1000)

      state.detectMemoryLeak()

      expect(warnSpy).toHaveBeenCalledTimes(1)
      const payload = warnSpy.mock.calls[0][1] as Record<string, string>
      expect(payload.heapUsed).toBe('900.0MB')
      // 新增字段：真正决定是否 OOM 的是占堆上限的比例
      expect(payload).toHaveProperty('heapUsedPercent')
      expect(payload).toHaveProperty('rss')
    })

    it('低基数下的高百分比增长不告警（8MB → 24MB）', () => {
      const state = internals()
      state.startedAt = 0
      // 增长 200%，但绝对增量仅 16MB，无诊断价值
      seedSnapshots(8, 24, 30 * 60 * 1000)

      state.detectMemoryLeak()

      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('内存到达平台期后不重复刷告警', () => {
      const state = internals()
      state.startedAt = 0
      seedSnapshots(300, 900, 30 * 60 * 1000)

      state.detectMemoryLeak()
      expect(warnSpy).toHaveBeenCalledTimes(1)

      // 冷却窗口内的第二次检测应被抑制
      state.detectMemoryLeak()
      expect(warnSpy).toHaveBeenCalledTimes(1)

      // 冷却期过后允许再次告警
      state.lastLeakWarningAt = lastTimestamp() - 11 * 60 * 1000
      state.detectMemoryLeak()
      expect(warnSpy).toHaveBeenCalledTimes(2)
    })

    it('快照不足 10 个时不做判定', () => {
      const state = internals()
      state.startedAt = 0
      seedSnapshots(9, 851, 30 * 60 * 1000)
      state.memorySnapshots = state.memorySnapshots.slice(0, 5)

      state.detectMemoryLeak()

      expect(warnSpy).not.toHaveBeenCalled()
    })
  })

  describe('detectMemoryPressure', () => {
    const snapshotAt = (heapUsedMB: number, timestamp: number): MemorySnapshot => ({
      timestamp,
      heapUsed: heapUsedMB * MB,
      heapTotal: heapUsedMB * 1.2 * MB,
      external: 0,
      rss: heapUsedMB * 1.5 * MB,
    })

    it('堆占用接近上限时告警，且不受预热窗口限制', () => {
      const state = internals()
      state.startedAt = 0
      state.heapLimit = 1000 * MB

      // 启动后仅 10s —— 预热期内，但 OOM 风险是真实的
      state.detectMemoryPressure(snapshotAt(850, 10_000))

      expect(errorSpy).toHaveBeenCalledTimes(1)
      const payload = errorSpy.mock.calls[0][1] as Record<string, string>
      expect(payload.heapUsedPercent).toBe('85.0%')
    })

    it('堆占用在水位以下时不告警', () => {
      const state = internals()
      state.heapLimit = 1000 * MB

      state.detectMemoryPressure(snapshotAt(500, 10_000))

      expect(errorSpy).not.toHaveBeenCalled()
    })

    it('拿不到堆上限时静默跳过（渲染进程）', () => {
      const state = internals()
      state.heapLimit = null

      state.detectMemoryPressure(snapshotAt(5_000, 10_000))

      expect(errorSpy).not.toHaveBeenCalled()
    })

    it('压力告警同样受冷却窗口约束', () => {
      const state = internals()
      state.heapLimit = 1000 * MB

      state.detectMemoryPressure(snapshotAt(850, 10_000))
      expect(errorSpy).toHaveBeenCalledTimes(1)

      state.detectMemoryPressure(snapshotAt(900, 60_000))
      expect(errorSpy).toHaveBeenCalledTimes(1)

      state.detectMemoryPressure(snapshotAt(950, 11 * 60 * 1000))
      expect(errorSpy).toHaveBeenCalledTimes(2)
    })
  })
})
