/**
 * 文件职责：
 * 1. 统一将工具调用序列切分为“可并行批次”和“必须串行批次”。
 * 2. 让执行层只负责“如何执行”，而不是一边遍历一边临时判断并行边界。
 * 3. 为后续继续演进更复杂的调度规则（依赖、资源占用、优先级）保留清晰入口。
 *
 * 当前策略比较克制：
 * - 连续的 parallel 工具会被合并成一个批次；
 * - 一旦遇到 parallel=false 的工具，就先冲刷前面的并行批次，再单独形成串行批次。
 */
import type { ToolCall } from '@/shared/types'
import { isParallelTool } from '@/shared/config/tools'

export interface ToolExecutionBatch {
  toolCalls: ToolCall[]
  parallel: boolean
}

/**
 * 把工具调用列表切成执行批次。
 *
 * 为什么要有这一层：
 * - 以前执行器里是一边循环一边维护 inFlight 状态，逻辑容易散。
 * - 抽成批次后，执行层可以先“规划”，再“执行”，架构更稳定。
 */
export function buildExecutionBatches(toolCalls: ToolCall[]): ToolExecutionBatch[] {
  const batches: ToolExecutionBatch[] = []
  let currentParallelBatch: ToolCall[] = []

  // 把当前累计的并行工具批次落盘，作为一个独立执行单元。
  const flushParallelBatch = () => {
    if (currentParallelBatch.length === 0) return
    batches.push({ toolCalls: currentParallelBatch, parallel: true })
    currentParallelBatch = []
  }

  for (const toolCall of toolCalls) {
    // 可并行工具：继续累积到当前并行批次里。
    if (isParallelTool(toolCall.name)) {
      currentParallelBatch.push(toolCall)
      continue
    }

    // 串行工具：先结束前面的并行批次，再给自己单独建一个串行批次。
    flushParallelBatch()
    batches.push({ toolCalls: [toolCall], parallel: false })
  }

  // 处理循环结束后残留的并行批次。
  flushParallelBatch()
  return batches
}
