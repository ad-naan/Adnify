/**
 * 防抖和节流工具函数
 */

/**
 * 防抖函数 - 在最后一次调用 n 毫秒后执行
 * @param func 要防抖的函数
 * @param wait 等待时间（毫秒）
 * @returns 包装后的函数
 */
export function debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeoutId: NodeJS.Timeout | null = null

    return function (...args: Parameters<T>) {
        if (timeoutId) {
            clearTimeout(timeoutId)
        }

        timeoutId = setTimeout(() => {
            func(...args)
        }, wait)
    }
}

/**
 * 节流函数 - 保证在 n 毫秒内最多执行一次
 * @param func 要节流的函数
 * @param limit 时间限制（毫秒）
 * @returns 包装后的函数
 */
export function throttle<T extends (...args: any[]) => any>(
    func: T,
    limit: number
): (...args: Parameters<T>) => void {
    let inThrottle = false
    let lastArgs: Parameters<T> | null = null

    return function (...args: Parameters<T>) {
        lastArgs = args
        if (!inThrottle) {
            func(...args)
            lastArgs = null
            inThrottle = true
            setTimeout(() => {
                inThrottle = false
                if (lastArgs) {
                    // 如果在节流期间有新的调用，在节流结束后立刻再执行一次最后积累的状态
                    func(...lastArgs)
                    lastArgs = null
                    inThrottle = true
                    setTimeout(() => {
                        inThrottle = false
                    }, limit)
                }
            }, limit)
        }
    }
}
