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
  const completedBlocks: string[] = canAppend
    ? previous.partition.completedBlocks as string[]
    : []
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
      completedBlocks.push(activeBlock)
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
      completedBlocks,
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
 */
export class StreamingMarkdownPartitioner {
  private state: StreamingMarkdownPartitionState | undefined

  update(content: string, appendOnly: boolean): StreamingMarkdownPartition {
    this.state = appendContent(this.state, content, appendOnly)
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
