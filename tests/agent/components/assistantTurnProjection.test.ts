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
  it('does not collapse pure final-text replies', () => {
    const projection = projectAssistantTurn([text('Final answer only.')])

    expect(projection.finalReplyParts).toEqual([text('Final answer only.')])
    expect(projection.processParts).toEqual([])
    expect(projection.hasVisibleFinalReply).toBe(true)
    expect(projection.shouldCollapseProcess).toBe(false)
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
    expect(projection.shouldCollapseProcess).toBe(true)
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
    expect(projection.shouldCollapseProcess).toBe(true)
  })

  it('keeps trailing sources visible with the final reply', () => {
    const projection = projectAssistantTurn([
      text('Answer with source.'),
      sources(),
    ])

    expect(projection.finalReplyParts).toEqual([text('Answer with source.'), sources()])
    expect(projection.processParts).toEqual([])
    expect(projection.summary.hasSources).toBe(false)
    expect(projection.shouldCollapseProcess).toBe(false)
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
    expect(projection.hasVisibleFinalReply).toBe(false)
    expect(projection.hasProcessContent).toBe(true)
    expect(projection.shouldCollapseProcess).toBe(true)
  })

  it('does not collapse while the turn is still active', () => {
    const projection = projectAssistantTurn([
      reasoning('Thinking...'),
      toolCall('tool-1'),
      text('Final answer.'),
    ], {
      isStreaming: true,
    })

    expect(projection.shouldCollapseProcess).toBe(false)
  })

  it('does not collapse while waiting for approval', () => {
    const projection = projectAssistantTurn([
      toolCall('tool-1'),
      text('Final answer.'),
    ], {
      isAwaitingApproval: true,
    })

    expect(projection.shouldCollapseProcess).toBe(false)
  })

  it('does not collapse when the user opts into expanded agent blocks', () => {
    const projection = projectAssistantTurn([
      toolCall('tool-1'),
      text('Final answer.'),
    ], {
      expandProcessByDefault: true,
    })

    expect(projection.shouldCollapseProcess).toBe(false)
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
    expect(projection.shouldCollapseProcess).toBe(true)
  })
})
