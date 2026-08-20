export interface StreamingMarkdownPartition {
  completedBlocks: string[]
  activeBlock: string
  hasOpenFence: boolean
}

/**
 * Split only at blank lines outside fenced code. Completed blocks are immutable
 * for an append-only stream, allowing their rendered trees to remain stable.
 */
export function partitionStreamingMarkdown(content: string): StreamingMarkdownPartition {
  const completedBlocks: string[] = []
  let blockStart = 0
  let lineStart = 0
  let fenceChar = ''
  let fenceLength = 0

  for (let index = 0; index < content.length; index++) {
    if (content[index] !== '\n') continue

    const line = content.slice(lineStart, index).trimStart()
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

    if (!fenceChar && line.trim().length === 0 && content.slice(blockStart, index + 1).trim().length > 0) {
      completedBlocks.push(content.slice(blockStart, index + 1))
      blockStart = index + 1
    }
    lineStart = index + 1
  }

  return {
    completedBlocks,
    activeBlock: content.slice(blockStart),
    hasOpenFence: fenceChar.length > 0,
  }
}
