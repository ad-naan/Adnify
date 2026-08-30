/**
 * IPC 流式批次信封的拆包。
 *
 * 主进程为了压低 IPC 频率会把一段时间内的流事件合成
 * `{ type: 'batch', events: [...] }` 一次性发出（见 StreamingService 的节流），
 * 未合批的事件则原样发送。两种形态在同一个频道上混流，所有订阅方都必须用同一套
 * 规则拆开——所以拆包逻辑只允许存在这一份。
 *
 * 之所以单独成文件而不是内联在 preload：主进程的 golden 测试需要把「主进程发出的
 * 载荷」拍平成「渲染端实际看到的序列」，两边必须用同一个实现，否则测试钉住的就不是
 * 真实行为。
 *
 * 注意：preload 必须用相对路径导入本文件。vite.config.ts 的 preload 入口没有配
 * resolve.alias（main 和 worker 都配了），preload 今天能编译只因为它所有别名导入
 * 都是 `import type`，会被擦除。
 */

/** 单个事件，或一批事件的信封 */
export type StreamBatchEnvelope<T> = T | { type: 'batch'; events: T[] }

/**
 * 按渲染端可见的顺序遍历一个载荷里的所有事件。
 * 合批信封展开成多次回调，非信封原样回调一次。
 */
export function forEachStreamChunk<T extends { type: string }>(
  data: StreamBatchEnvelope<T>,
  onChunk: (chunk: T) => void,
): void {
  if (data.type === 'batch' && 'events' in data) {
    for (const event of data.events) {
      onChunk(event)
    }
    return
  }

  onChunk(data as T)
}
