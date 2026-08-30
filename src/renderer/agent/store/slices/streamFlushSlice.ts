/**
 * 流式缓冲的落地通道。
 *
 * 助手行的几处结构性写入（加工具调用 part、开始/结束工具执行、工具调用前收尾正文）
 * 都必须先把这条消息还压在 StreamingBuffer 里的 token 落地，否则新 part 会插到
 * 那批文字**前面**——界面上工具卡片跑到了它本应跟随的正文之前。
 *
 * 单独成一个 slice 的原因是类型：以前它只存在于 AgentStore 的返回对象里，
 * messageSlice 只能用 `get() as ... & { _flushTextBuffer?: ... }` 这样未类型化的
 * cast 加可选调用去触达它。那意味着**删掉这个方法只会静默 no-op**，类型检查不响、
 * 测试也抓不到，坏掉的只是 parts 的顺序。现在它是 store 类型的一等成员。
 */

import { streamingBuffer } from '../StreamingBuffer'
import { assertOutsideStoreUpdater } from '../storeUpdaterGuard'

export interface StreamFlushSlice {
    /**
     * 立即落地 `messageId` 这一条消息缓冲中的正文与推理，其余消息保持原节奏。
     *
     * 必须在 `set()` 之外调用：它内部会走 `_doAppendToAssistant` → `set()`，
     * 在 updater 内部调用就成了嵌套 set，外层返回的 partial 会在内层写入之后合并，
     * 把刚落地的那段文字静默盖掉。
     */
    _flushTextBuffer: (messageId: string) => void
}

export const createStreamFlushSlice = (): StreamFlushSlice => ({
    _flushTextBuffer: (messageId: string) => {
        assertOutsideStoreUpdater('_flushTextBuffer')
        streamingBuffer.flushMessage(messageId)
    },
})
