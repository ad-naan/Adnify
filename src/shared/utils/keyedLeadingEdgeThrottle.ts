/**
 * 按 key 分组的前沿节流器（带累加）。
 *
 * ── 为什么不用同目录的 throttle() ──
 * debounce.ts 的 throttle 只保留「最后一次调用的参数」。对流式数据来说这等于丢
 * token：节流窗口内到达的每一块都必须保留下来，合成一次发送，而不是只留最后一块。
 * 所以这里的核心是 `accumulate`——调用方决定「怎么把新数据并进挂起的载荷」，
 * 字符串就是拼接，事件流就是 concat。
 *
 * ── 为什么是前沿 ──
 * 防抖下持续输出会被一直推迟，直到输出停顿才刷新，表现为「长时间空白后突然刷屏」。
 * 这个坑在这个仓库里踩过两次：终端的 PTY 输出（已修，注释写在 secureTerminal.ts）
 * 和 LLM 流式事件（StreamingService 的 sendEvent，就是本次要修的）。两处各自内联
 * 了一份实现，且都退化成了后沿节流——首块也要等满一个窗口。
 *
 * 语义（这三条由 tests/shared/keyedLeadingEdgeThrottle.test.ts 钉住）：
 *   1. **首块零延迟**：空闲状态下 push 立即 emit，不等窗口。
 *   2. **不是防抖**：窗口一旦排定就不会被后续 push 推迟，所以持续输出稳定按
 *      intervalMs 出货，缓冲不会无界增长。
 *   3. **空闲即复位**：一个窗口结束时没有挂起数据就关掉窗口，下一次 push 又是
 *      立即送达。所以「停顿后的第一个字」永远不付延迟。
 */

export interface KeyedLeadingEdgeThrottleOptions<K, T> {
  /** 出货间隔上限。窗口内的多次 push 合成一次 emit */
  intervalMs: number
  /** 把 next 并进该 key 挂起的载荷；pending 为 undefined 表示这是窗口内第一块 */
  accumulate: (pending: T | undefined, next: T) => T
  /** 真正送出去。抛错不会打断节流器状态 */
  emit: (key: K, payload: T) => void
  /** emit 抛错时的兜底（默认静默） */
  onEmitError?: (error: unknown, key: K) => void
}

export interface KeyedLeadingEdgeThrottle<K, T> {
  /** 喂一块数据。可能同步触发 emit（前沿） */
  push(key: K, value: T): void
  /** 立即送出该 key 挂起的数据并关闭窗口。没有挂起数据时什么都不做 */
  flush(key: K): void
  /** 对所有 key 依次 flush */
  flushAll(): void
  /** 丢弃该 key 的挂起数据并清理定时器（abort / 关闭走这条，不 emit） */
  release(key: K): void
  /** 丢弃全部 key */
  releaseAll(): void
  /** 该 key 是否有尚未送出的数据 */
  hasPending(key: K): boolean
  /** 仍被跟踪的 key 数量。用于在测试里断言没有泄漏 */
  size(): number
}

interface Entry<T> {
  pending: T | undefined
  hasPending: boolean
  timer: ReturnType<typeof setTimeout> | null
}

export function createKeyedLeadingEdgeThrottle<K, T>(
  options: KeyedLeadingEdgeThrottleOptions<K, T>,
): KeyedLeadingEdgeThrottle<K, T> {
  const { intervalMs, accumulate, emit, onEmitError } = options
  const entries = new Map<K, Entry<T>>()

  const safeEmit = (key: K, payload: T): void => {
    try {
      emit(key, payload)
    } catch (error) {
      onEmitError?.(error, key)
    }
  }

  /** 取出挂起载荷并清空。返回 false 表示本来就没有东西可送 */
  const drain = (key: K, entry: Entry<T>): boolean => {
    if (!entry.hasPending) return false

    const payload = entry.pending as T
    entry.pending = undefined
    entry.hasPending = false
    safeEmit(key, payload)
    return true
  }

  /** 窗口到点：有货就送并续窗口，没货就关窗口并把 key 从表里摘掉 */
  const onWindowElapsed = (key: K): void => {
    const entry = entries.get(key)
    if (!entry) return

    entry.timer = null

    if (drain(key, entry)) {
      openWindow(key, entry)
      return
    }

    // 空闲复位：下一次 push 又是零延迟
    entries.delete(key)
  }

  const openWindow = (key: K, entry: Entry<T>): void => {
    entry.timer = setTimeout(() => onWindowElapsed(key), intervalMs)
  }

  const clearTimer = (entry: Entry<T>): void => {
    if (entry.timer !== null) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
  }

  return {
    push(key, value) {
      const existing = entries.get(key)

      // 前沿：空闲状态直接送出，然后开一个窗口挡住后续
      if (!existing) {
        const entry: Entry<T> = { pending: undefined, hasPending: false, timer: null }
        entries.set(key, entry)
        safeEmit(key, accumulate(undefined, value))
        openWindow(key, entry)
        return
      }

      existing.pending = accumulate(existing.hasPending ? existing.pending : undefined, value)
      existing.hasPending = true

      // 窗口已排定就不动它——推迟窗口就退化成防抖了
      if (existing.timer === null) {
        openWindow(key, existing)
      }
    },

    flush(key) {
      const entry = entries.get(key)
      if (!entry) return

      clearTimer(entry)
      drain(key, entry)
      // 关掉窗口：flush 通常发生在「必须保证顺序」的时刻（例如工具边界事件
      // 之前），之后的第一块应当同样零延迟。
      entries.delete(key)
    },

    flushAll() {
      for (const key of [...entries.keys()]) {
        this.flush(key)
      }
    },

    release(key) {
      const entry = entries.get(key)
      if (!entry) return

      clearTimer(entry)
      entries.delete(key)
    },

    releaseAll() {
      for (const entry of entries.values()) {
        clearTimer(entry)
      }
      entries.clear()
    },

    hasPending(key) {
      return entries.get(key)?.hasPending ?? false
    },

    size() {
      return entries.size
    },
  }
}
