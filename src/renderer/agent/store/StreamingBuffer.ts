/**
 * 流式响应节流缓冲区
 * 
 * 用于优化高频更新，通过 requestAnimationFrame 实现约 60fps 的批量更新
 * 减少 React 渲染次数，提升性能
 */

type FlushCallback = (messageId: string, content: string, threadId?: string) => void

type ReasoningFlushCallback = (
    messageId: string,
    partId: string,
    content: string,
    isStreaming: boolean,
    threadId?: string
) => void

interface ReasoningEntry {
    messageId: string
    partId: string
    content: string
    isStreaming: boolean
    threadId?: string
}

class StreamingBuffer {
    private buffer: Map<string, { content: string; threadId?: string }> = new Map()
    private reasoningBuffer: Map<string, Map<string, ReasoningEntry>> = new Map()
    private timerId: ReturnType<typeof setTimeout> | null = null
    private flushCallback: FlushCallback | null = null
    private reasoningFlushCallback: ReasoningFlushCallback | null = null
    // Keep the display cadence at ~30fps. Renderer work is reduced downstream
    // instead of delaying chunks, so the visible text can keep up with fast
    // model output and still finish on the final flush.
    private readonly flushIntervalMs = 33

    setFlushCallback(callback: FlushCallback) {
        this.flushCallback = callback
    }

    setReasoningFlushCallback(callback: ReasoningFlushCallback) {
        this.reasoningFlushCallback = callback
    }

    /**
     * 缓冲推理内容。与文本通道共享同一节流时钟，但各自独立累积，
     * 避免推理 token 绕过节流直接触发 store 更新。
     */
    appendReasoning(
        messageId: string,
        partId: string,
        content: string,
        isStreaming: boolean,
        threadId?: string
    ): void {
        if (!content) return

        // 两级 Map（messageId -> partId -> entry），避免拼接键在 id 含分隔符时串号
        let byPart = this.reasoningBuffer.get(messageId)
        if (!byPart) {
            byPart = new Map()
            this.reasoningBuffer.set(messageId, byPart)
        }

        const existing = byPart.get(partId)
        if (existing) {
            existing.content += content
            existing.isStreaming = isStreaming
            existing.threadId = threadId ?? existing.threadId
        } else {
            byPart.set(partId, { messageId, partId, content, isStreaming, threadId })
        }

        this.scheduleFlush()
    }

    append(messageId: string, content: string, threadId?: string): void {
        if (!content) return

        const existing = this.buffer.get(messageId)

        if (existing) {
            this.buffer.set(messageId, {
                content: existing.content + content,
                threadId: threadId || existing.threadId
            })
        } else {
            this.buffer.set(messageId, { content, threadId })
        }

        // 优化：第一次数据立即刷新，后续数据节流
        this.scheduleFlush()
    }

    private scheduleFlush(): void {
        if (this.timerId !== null) return

        // 节流到约 30fps（flushIntervalMs）；已排定的 flush 不会被后续 append 推迟，
        // 因此持续的 token 流不会让缓冲无界增长。
        this.timerId = setTimeout(() => {
            this.timerId = null
            this.flush()
        }, this.flushIntervalMs)
    }

    private flush(): void {
        this.flushText()
        this.flushReasoning()
    }

    private flushText(): void {
        if (!this.flushCallback || this.buffer.size === 0) return

        const updates = new Map(this.buffer)
        this.buffer.clear()

        updates.forEach(({ content, threadId }, messageId) => {
            if (content) {
                this.flushCallback!(messageId, content, threadId)
            }
        })
    }

    private flushReasoning(): void {
        if (!this.reasoningFlushCallback || this.reasoningBuffer.size === 0) return

        const updates = this.reasoningBuffer
        this.reasoningBuffer = new Map()

        updates.forEach(byPart => {
            byPart.forEach(({ messageId, partId, content, isStreaming, threadId }) => {
                if (content) {
                    this.reasoningFlushCallback!(messageId, partId, content, isStreaming, threadId)
                }
            })
        })
    }

    /**
     * 只排空一条消息的缓冲（正文 + 该消息下所有推理段）。
     *
     * 「改这条消息的 parts 之前先把它的正文落地」要的只有这一条。以前这个需求走的是
     * flushNow()，于是同时在流的其他线程（后台任务）的缓冲也被一并写进 store ——
     * 一个没人声明过的跨线程副作用。已排定的定时器保持不动，其余消息照原节奏落地。
     */
    flushMessage(messageId: string): void {
        const text = this.buffer.get(messageId)
        if (text) {
            this.buffer.delete(messageId)
            if (text.content) {
                this.flushCallback?.(messageId, text.content, text.threadId)
            }
        }

        const byPart = this.reasoningBuffer.get(messageId)
        if (byPart) {
            this.reasoningBuffer.delete(messageId)
            byPart.forEach(({ partId, content, isStreaming, threadId }) => {
                if (content) {
                    this.reasoningFlushCallback?.(messageId, partId, content, isStreaming, threadId)
                }
            })
        }
    }

    flushNow(): void {
        if (this.timerId !== null) {
            clearTimeout(this.timerId)
            this.timerId = null
        }
        this.flush()
    }

    clear(): void {
        if (this.timerId !== null) {
            clearTimeout(this.timerId)
            this.timerId = null
        }
        this.buffer.clear()
        this.reasoningBuffer.clear()
    }
}

// 单例实例
export const streamingBuffer = new StreamingBuffer()

// 导出刷新函数，供外部在关键时刻调用
export function flushStreamingBuffer(): void {
    streamingBuffer.flushNow()
}
