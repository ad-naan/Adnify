import { beforeEach, describe, expect, it, vi } from 'vitest'

const streamHarness = vi.hoisted(() => ({
  stream: undefined as ((data: Record<string, unknown>) => void) | undefined,
  done: undefined as ((data: Record<string, unknown>) => void) | undefined,
  error: undefined as ((data: Record<string, unknown>) => void) | undefined,
}))

vi.mock('@/renderer/services/electronAPI', () => ({
  api: {
    llm: {
      onStream: vi.fn((_requestId: string, callback: (data: Record<string, unknown>) => void) => {
        streamHarness.stream = callback
        return vi.fn()
      }),
      onDone: vi.fn((_requestId: string, callback: (data: Record<string, unknown>) => void) => {
        streamHarness.done = callback
        return vi.fn()
      }),
      onError: vi.fn((_requestId: string, callback: (data: Record<string, unknown>) => void) => {
        streamHarness.error = callback
        return vi.fn()
      }),
    },
  },
}))

vi.mock('@store', () => ({
  useStore: {
    getState: () => ({ workspacePath: 'D:\\workspace', language: 'en' }),
  },
}))

import { createStreamProcessor } from '@/renderer/agent/core/stream'

function createProcessor() {
  const processor = createStreamProcessor(null, {} as never, 'stream-test')
  expect(streamHarness.stream).toBeTypeOf('function')
  expect(streamHarness.done).toBeTypeOf('function')
  return processor
}

describe('tool call stream assembly', () => {
  beforeEach(() => {
    streamHarness.stream = undefined
    streamHarness.done = undefined
    streamHarness.error = undefined
    if (typeof window.setTimeout !== 'function') {
      window.setTimeout = setTimeout as typeof window.setTimeout
    }
  })

  it('uses final available arguments when the provider sends no argument deltas', async () => {
    const processor = createProcessor()
    const expected = { path: 'src/index.ts', content: 'export {}\n' }

    streamHarness.stream!({ type: 'tool_call_start', id: 'write-1', name: 'write_file' })
    streamHarness.stream!({ type: 'tool_call_delta_end', id: 'write-1' })
    streamHarness.stream!({
      type: 'tool_call_available',
      id: 'write-1',
      name: 'write_file',
      arguments: expected,
    })
    streamHarness.done!({})

    const result = await processor.wait()
    expect(result.toolCalls).toEqual([
      expect.objectContaining({ id: 'write-1', name: 'write_file', arguments: expected }),
    ])
  })

  it('replaces incomplete streamed arguments with the final available payload', async () => {
    const processor = createProcessor()
    const expected = { path: 'README.md', content: '# New project\n' }

    streamHarness.stream!({ type: 'tool_call_start', id: 'write-2', name: 'write_file' })
    streamHarness.stream!({
      type: 'tool_call_delta',
      id: 'write-2',
      argumentsDelta: '{"path":"README.md","content":"# New',
    })
    streamHarness.stream!({ type: 'tool_call_delta_end', id: 'write-2' })
    streamHarness.stream!({
      type: 'tool_call_available',
      id: 'write-2',
      name: 'write_file',
      arguments: expected,
    })
    streamHarness.done!({})

    const result = await processor.wait()
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls?.[0]?.arguments).toEqual(expected)
  })

  it('falls back to complete streamed arguments when no available event arrives', async () => {
    const processor = createProcessor()
    const expected = { path: 'package.json', content: '{}\n' }

    streamHarness.stream!({ type: 'tool_call_start', id: 'write-3', name: 'write_file' })
    streamHarness.stream!({
      type: 'tool_call_delta',
      id: 'write-3',
      argumentsDelta: JSON.stringify(expected),
    })
    streamHarness.stream!({ type: 'tool_call_delta_end', id: 'write-3' })
    streamHarness.done!({})

    const result = await processor.wait()
    expect(result.toolCalls?.[0]?.arguments).toEqual(expected)
  })

  it('does not execute an empty fallback when no arguments arrive', async () => {
    const processor = createProcessor()

    streamHarness.stream!({ type: 'tool_call_start', id: 'write-4', name: 'write_file' })
    streamHarness.stream!({ type: 'tool_call_delta_end', id: 'write-4' })
    streamHarness.done!({})

    const result = await processor.wait()
    expect(result.toolCalls).toEqual([])
  })

  it('filters tool markup split across arbitrary text chunks', async () => {
    const processor = createProcessor()
    const leaked = '<tool_call id="write-5">hidden arguments</tool_call>'

    streamHarness.stream!({ type: 'text', content: 'visible before ' })
    for (const character of leaked) {
      streamHarness.stream!({ type: 'text', content: character })
    }
    streamHarness.stream!({ type: 'text', content: ' visible after' })
    streamHarness.done!({})

    const result = await processor.wait()
    expect(result.content).toBe('visible before  visible after')
  })

  it('flushes a partial non-tool tag prefix when the stream ends', async () => {
    const processor = createProcessor()

    streamHarness.stream!({ type: 'text', content: 'visible <tool_' })
    streamHarness.done!({})

    const result = await processor.wait()
    expect(result.content).toBe('visible <tool_')
  })
})
