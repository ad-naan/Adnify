import { describe, expect, it } from 'vitest'
import type { AssistantPart, ToolCall } from '@renderer/agent/types'
import { projectAssistantTurn } from '@renderer/components/agent/assistantTurnProjection'

function text(content: string): AssistantPart {
  return { type: 'text', content }
}

function reasoning(content: string): AssistantPart {
  return {
    id: 'reasoning-1',
    type: 'reasoning',
    content,
    isStreaming: false,
  }
}

function toolCall(id: string, name = 'read_file'): AssistantPart {
  const tool: ToolCall = {
    id,
    name,
    arguments: {},
    status: 'success',
  }

  return {
    type: 'tool_call',
    toolCall: tool,
  }
}

function search(content: string): AssistantPart {
  return {
    id: 'search-1',
    type: 'search',
    content,
    isStreaming: false,
  }
}

function sources(): AssistantPart {
  return {
    type: 'sources',
    sources: [
      {
        id: 'source-1',
        sourceType: 'url',
        title: 'Source',
        url: 'https://example.com',
      },
    ],
  }
}

describe('assistantTurnProjection', () => {
  it('collects browser results, screenshots and errors with other tools while retaining the final reply', () => {
    const screenshot = toolCall('screenshot', 'browser_inspect') as Extract<AssistantPart, { type: 'tool_call' }>
    screenshot.toolCall.richContent = [{ type: 'image', data: 'image-data', mimeType: 'image/jpeg' }, { type: 'markdown', text: 'Visual analysis' }]
    const failed = toolCall('failed', 'browser_action') as Extract<AssistantPart, { type: 'tool_call' }>
    failed.toolCall.status = 'error'
    const parts = [toolCall('read'), toolCall('open', 'browser_open'), failed, reasoning('Inspect the result'), screenshot, text('Final verified answer')]
    const projection = projectAssistantTurn(parts)
    expect(projection.processParts).toEqual(parts.slice(0, -1))
    expect(projection.finalReplyParts).toEqual([parts.at(-1)])
    expect(projection.summary.toolCallCount).toBe(4)
  })

  it('does not collapse pure final-text replies', () => {
    const projection = projectAssistantTurn([text('Final answer only.')])

    expect(projection.finalReplyParts).toEqual([text('Final answer only.')])
    expect(projection.processParts).toEqual([])
  })

  it('keeps only the final text visible after reasoning and tools', () => {
    const projection = projectAssistantTurn([
      reasoning('Thinking...'),
      toolCall('tool-1'),
      text('Final answer.'),
    ])

    expect(projection.finalReplyParts).toEqual([text('Final answer.')])
    expect(projection.processParts).toEqual([
      reasoning('Thinking...'),
      toolCall('tool-1'),
    ])
    expect(projection.summary.hasReasoning).toBe(true)
    expect(projection.summary.toolCallCount).toBe(1)
  })

  it('moves pre-tool explanation text into the collapsed process block', () => {
    const projection = projectAssistantTurn([
      text('先看一下仓库结构。'),
      toolCall('tool-1'),
      text('已经处理好了。'),
    ])

    expect(projection.finalReplyParts).toEqual([text('已经处理好了。')])
    expect(projection.processParts).toEqual([
      text('先看一下仓库结构。'),
      toolCall('tool-1'),
    ])
    expect(projection.summary.hasProcessText).toBe(true)
  })

  it('preserves interleaved text and tool order inside the collapsed process block', () => {
    const parts = [
      text('先读取配置。'),
      toolCall('tool-1', 'read_file'),
      text('再检查调用方。'),
      toolCall('tool-2', 'search_files'),
      text('最终结论。'),
    ]
    const projection = projectAssistantTurn(parts)

    expect(projection.processParts).toEqual(parts.slice(0, 4))
    expect(projection.finalReplyParts).toEqual([parts[4]])
  })

  it('keeps trailing sources visible with the final reply', () => {
    const projection = projectAssistantTurn([
      text('Answer with source.'),
      sources(),
    ])

    expect(projection.finalReplyParts).toEqual([text('Answer with source.'), sources()])
    expect(projection.processParts).toEqual([])
    expect(projection.summary.hasSources).toBe(false)
  })

  it('shows only the process block when there is no final text', () => {
    const projection = projectAssistantTurn([
      reasoning('Thinking...'),
      toolCall('tool-1'),
      search('Found files'),
    ])

    expect(projection.finalReplyParts).toEqual([])
    expect(projection.processParts).toEqual([
      reasoning('Thinking...'),
      toolCall('tool-1'),
      search('Found files'),
    ])
    expect(projection.hasProcessContent).toBe(true)
  })

  it('does not move an earlier explanation behind later process parts', () => {
    const parts = [
      text('先看一下仓库。'),
      toolCall('tool-1'),
      reasoning('Summarize the project.'),
    ]
    const projection = projectAssistantTurn(parts)

    expect(projection.finalReplyParts).toEqual([])
    expect(projection.processParts).toEqual(parts)
  })

  it('treats context-only metadata as process content', () => {
    const projection = projectAssistantTurn([
      text('Final answer.'),
    ], {
      hasContextMeta: true,
    })

    expect(projection.finalReplyParts).toEqual([text('Final answer.')])
    expect(projection.processParts).toEqual([])
    expect(projection.summary.hasContext).toBe(true)
    expect(projection.hasProcessContent).toBe(true)
  })
})
