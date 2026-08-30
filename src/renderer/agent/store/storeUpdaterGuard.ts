/**
 * store 更新器的重入护栏。
 *
 * zustand 的 `set(updater)` 会把 updater 的返回值合并进状态。如果在 updater **内部**
 * 再触发一次 `set()`（典型路径：`_flushTextBuffer` → `_doAppendToAssistant` → `set()`），
 * 内层先写入，外层的 partial 随后合并——**静默盖掉内层刚写进去的那段文字**。
 *
 * 这类丢失没有任何下游断言能发现：类型是对的，测试看到的是「文字少了一段」而不是报错。
 * 今天全靠三个调用点「恰好」把刷缓冲写在 `set()` 上面。所以这里选择抛错而不是打日志。
 */

let updaterDepth = 0

/** 在 `set()` 的 updater 内部执行 `fn`，期间任何 `assertOutsideStoreUpdater` 都会抛错 */
export function runStoreUpdater<T>(fn: () => T): T {
    updaterDepth += 1
    try {
        return fn()
    } finally {
        updaterDepth -= 1
    }
}

/** 声明「这个操作会自己调用 `set()`，因此绝不能被嵌在别人的 updater 里」 */
export function assertOutsideStoreUpdater(label: string): void {
    if (updaterDepth > 0) {
        throw new Error(
            `[store] ${label} 会自己调用 set()，不能在另一个 set() 的 updater 内部执行：` +
            '内层写入会被外层返回的 partial 静默盖掉。把它移到 set() 之外。'
        )
    }
}
