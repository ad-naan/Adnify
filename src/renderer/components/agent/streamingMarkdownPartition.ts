export interface StreamingMarkdownPartition {
  completedBlocks: readonly string[]
  activeBlock: string
  hasOpenFence: boolean
}

interface StreamingMarkdownPartitionState {
  partition: StreamingMarkdownPartition
  processedLength: number
  pendingLineLength: number
  fenceChar: string
  fenceLength: number
}

const SOURCE_TAIL_LENGTH = 64
const EMPTY_BLOCKS: readonly string[] = []

function getPartitionTail(partition: StreamingMarkdownPartition, length: number): string {
  let tail = partition.activeBlock

  for (let index = partition.completedBlocks.length - 1; tail.length < length && index >= 0; index--) {
    tail = partition.completedBlocks[index] + tail
  }

  return tail.slice(-length)
}

function isAppend(previous: StreamingMarkdownPartitionState, content: string): boolean {
  if (content.length < previous.processedLength) return false

  const tailLength = Math.min(previous.processedLength, SOURCE_TAIL_LENGTH)
  const tailStart = previous.processedLength - tailLength
  return content.slice(tailStart, previous.processedLength) === getPartitionTail(previous.partition, tailLength)
}

function appendContent(
  previous: StreamingMarkdownPartitionState | undefined,
  content: string,
  appendOnly: boolean,
): StreamingMarkdownPartitionState {
  const canAppend = appendOnly && previous && isAppend(previous, content)

  // 已完成的块列表**从不原地改动**：上一次 update 返回的 partition 是调用方还持有的
  // 值（useMemo 的缓存、React 上一帧的渲染结果），原地 push 会让那些「过去的值」
  // 跟着变，StrictMode 双调用下就成了同一段文字被数进去两次。真有块收尾时才拷一份，
  // 而收尾只发生在栅栏之外的空行处 —— 绝大多数 token 帧一次都不会拷。
  const baseBlocks: readonly string[] = canAppend ? previous.partition.completedBlocks : EMPTY_BLOCKS
  let grownBlocks: string[] | undefined
  const completeBlock = (block: string) => {
    if (!grownBlocks) grownBlocks = baseBlocks.slice()
    grownBlocks.push(block)
  }

  let activeBlock = canAppend ? previous.partition.activeBlock : ''
  let pendingLineLength = canAppend ? previous.pendingLineLength : 0
  let fenceChar = canAppend ? previous.fenceChar : ''
  let fenceLength = canAppend ? previous.fenceLength : 0
  const startIndex = canAppend ? previous.processedLength : 0
  let segmentStart = startIndex

  for (let index = startIndex; index < content.length; index++) {
    if (content[index] !== '\n') continue

    const lineFragment = content.slice(segmentStart, index)
    activeBlock += content.slice(segmentStart, index + 1)
    const lineLength = pendingLineLength + lineFragment.length
    const line = activeBlock.slice(activeBlock.length - lineLength - 1, -1).trimStart()
    const fence = /^(?:(`{3,})|(~{3,}))/.exec(line)
    if (fence) {
      const marker = fence[1] || fence[2]
      if (!fenceChar) {
        fenceChar = marker[0]
        fenceLength = marker.length
      } else if (marker[0] === fenceChar && marker.length >= fenceLength) {
        fenceChar = ''
        fenceLength = 0
      }
    }

    if (!fenceChar && line.trim().length === 0 && activeBlock.trim().length > 0) {
      completeBlock(activeBlock)
      activeBlock = ''
    }

    pendingLineLength = 0
    segmentStart = index + 1
  }

  if (segmentStart < content.length) {
    const remainder = content.slice(segmentStart)
    activeBlock += remainder
    pendingLineLength += remainder.length
  }

  return {
    partition: {
      completedBlocks: grownBlocks ?? baseBlocks,
      activeBlock,
      hasOpenFence: fenceChar.length > 0,
    },
    processedLength: content.length,
    pendingLineLength,
    fenceChar,
    fenceLength,
  }
}

/**
 * Keeps only parser state and finalized blocks between append-only stream
 * updates. Finalized block strings retain their identity while the owned list
 * only grows; only the new suffix is scanned. A bounded tail check catches
 * stream rollbacks, and a non-append update fully rebuilds the final result.
 *
 * `update` 是**幂等**的：同一对 `(content, appendOnly)` 连续调用返回同一个
 * partition 对象，内部状态不再推进。调用方是 `useMemo` 里的一次副作用，而
 * StrictMode 会把 useMemo 的计算函数跑两遍 —— 不幂等的话第二遍会把同一段
 * 文字再数一次。
 */
export class StreamingMarkdownPartitioner {
  private state: StreamingMarkdownPartitionState | undefined
  private lastContent: string | undefined
  private lastAppendOnly: boolean | undefined

  update(content: string, appendOnly: boolean): StreamingMarkdownPartition {
    if (this.state && content === this.lastContent && appendOnly === this.lastAppendOnly) {
      return this.state.partition
    }

    this.state = appendContent(this.state, content, appendOnly)
    this.lastContent = content
    this.lastAppendOnly = appendOnly
    return this.state.partition
  }
}

/**
 * Split only at blank lines outside fenced code using the same state machine as
 * streaming updates.
 */
export function partitionStreamingMarkdown(content: string): StreamingMarkdownPartition {
  return appendContent(undefined, content, false).partition
}
