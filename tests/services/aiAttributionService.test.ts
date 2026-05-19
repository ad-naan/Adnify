import { describe, expect, it } from 'vitest'
import {
  classifyCommitAddedLines,
  createAiCandidateBlocks,
  parseAddedCommitLinesFromPatch,
  type AiWriteEvent,
} from '@/renderer/services/aiAttributionService'

describe('aiAttributionService helpers', () => {
  it('extracts AI candidate blocks with line hashes and anchors', () => {
    const oldContent = [
      'function greet() {',
      '  return "hi"',
      '}',
      '',
    ].join('\n')
    const newContent = [
      'function greet() {',
      '  const message = "hello from ai"',
      '  return message',
      '}',
      '',
    ].join('\n')

    const blocks = createAiCandidateBlocks(oldContent, newContent, 'src/greet.ts')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].relativePath).toBe('src/greet.ts')
    expect(blocks[0].startLine).toBe(2)
    expect(blocks[0].endLine).toBe(3)
    expect(blocks[0].lineHashes).toHaveLength(2)
    expect(blocks[0].prevAnchorHash).toBeTruthy()
    expect(blocks[0].nextAnchorHash).toBeTruthy()
  })

  it('parses added commit lines from unified patch text', () => {
    const patch = [
      'diff --git a/src/greet.ts b/src/greet.ts',
      'index 0000000..1111111 100644',
      '--- a/src/greet.ts',
      '+++ b/src/greet.ts',
      '@@ -1,3 +1,4 @@',
      ' function greet() {',
      '+  const message = "hello from ai"',
      '   return "hi"',
      ' }',
      '',
    ].join('\n')

    const addedLines = parseAddedCommitLinesFromPatch(patch)
    expect(addedLines).toEqual([
      expect.objectContaining({
        path: 'src/greet.ts',
        lineNumber: 2,
        content: '  const message = "hello from ai"',
      }),
    ])
  })

  it('classifies pure ai, ai modified, and human lines', () => {
    const generatedBlocks = createAiCandidateBlocks(
      '',
      [
        'const exact = "pure ai"',
        'const changed = "hello from ai"',
        '',
      ].join('\n'),
      'src/greet.ts',
    ).map(block => ({
      ...block,
      prevAnchorHash: 'anchor-prev',
      nextAnchorHash: 'anchor-next',
    }))

    const event: AiWriteEvent = {
      version: 1,
      eventId: 'event-1',
      timestamp: Date.now(),
      repoRoot: '/repo',
      branch: 'feature/ai',
      workspaceRoot: '/repo',
      filePath: '/repo/src/greet.ts',
      relativePath: 'src/greet.ts',
      toolName: 'write_file',
      provider: 'openai',
      modelId: 'gpt-test',
      preHash: 'a',
      postHash: 'b',
      linesAdded: 2,
      linesRemoved: 0,
      preview: 'preview',
      aiBlocks: generatedBlocks,
    }

    const results = classifyCommitAddedLines([
      {
        path: 'src/greet.ts',
        lineNumber: 2,
        content: 'const exact = "pure ai"',
        hunkContextHashes: ['anchor-prev', 'anchor-next'],
      },
      {
        path: 'src/greet.ts',
        lineNumber: 3,
        content: 'const changed = "hello from AI and human"',
        hunkContextHashes: ['anchor-prev', 'anchor-next'],
      },
      {
        path: 'src/greet.ts',
        lineNumber: 4,
        content: 'const human = "written manually"',
        hunkContextHashes: ['anchor-prev', 'anchor-next'],
      },
    ], [event], 0.55)

    expect(results.map(result => result.kind)).toEqual(['pure_ai', 'ai_modified', 'human'])
    expect(results[1]).toEqual(expect.objectContaining({
      provider: 'openai',
      modelId: 'gpt-test',
      eventId: 'event-1',
    }))
  })
})
