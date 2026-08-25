import { describe, expect, it } from 'vitest'
import { isInternalToolRoutingCategory, ToolRoutingAdvisor } from '@/renderer/agent/utils/ToolRoutingAdvisor'

function record(advisor: ToolRoutingAdvisor, name: string, args: Record<string, unknown>, success = true): void {
  advisor.recordExecutedTool({ name, arguments: args }, success)
}

describe('ToolRoutingAdvisor', () => {
  it('classifies routing corrections as internal-only feedback', () => {
    expect(isInternalToolRoutingCategory('semantic_navigation')).toBe(true)
    expect(isInternalToolRoutingCategory('tool_routing')).toBe(true)
    expect(isInternalToolRoutingCategory('exact_repeat')).toBe(false)
  })

  it('redirects the second whole-source read to semantic navigation', () => {
    const advisor = new ToolRoutingAdvisor()
    record(advisor, 'read_file', { path: 'src/a.ts' })

    const result = advisor.check([{ id: '2', name: 'read_file', arguments: { path: 'src/b.ts' } }])

    expect(result.details?.category).toBe('semantic_navigation')
    expect(result.suggestion).toContain('find_symbol')
    expect(result.suggestion).toContain('stop navigating and edit')
  })

  it('recognizes explicit multi-file paths as source reads', () => {
    const advisor = new ToolRoutingAdvisor()
    record(advisor, 'read_file', { path: 'src/main.tsx' })

    const result = advisor.check([{
      id: '2',
      name: 'read_file',
      arguments: { paths: ['src/a.ts', 'src/b.ts'] },
    }])

    expect(result.details).toMatchObject({ category: 'semantic_navigation', threshold: 2 })
  })

  it('resets whole-source reads after targeted navigation', () => {
    const advisor = new ToolRoutingAdvisor()
    record(advisor, 'read_file', { path: 'src/a.ts' })
    record(advisor, 'find_symbol', { name_path: 'Service/run' })

    expect(advisor.check([{ id: '3', name: 'read_file', arguments: { path: 'src/b.ts' } }]).warning).toBeUndefined()
  })

  it('allows read fallback after a semantic tool fails', () => {
    const advisor = new ToolRoutingAdvisor()
    record(advisor, 'read_file', { path: 'src/a.rs' })
    record(advisor, 'get_document_symbols', { path: 'src/a.rs' }, false)

    expect(advisor.check([{ id: '3', name: 'read_file', arguments: { path: 'src/b.rs' } }]).warning).toBeUndefined()
  })

  it('stops fallback from becoming another whole-file reading loop', () => {
    const advisor = new ToolRoutingAdvisor()
    record(advisor, 'get_document_symbols', { path: 'src/a.rs' }, false)
    record(advisor, 'read_file', { path: 'src/a.rs' })

    const result = advisor.check([{ id: '3', name: 'read_file', arguments: { path: 'src/b.rs' } }])

    expect(result.details).toMatchObject({ category: 'semantic_navigation', pattern: 'fallback_source_read_burst' })
    expect(result.suggestion).toContain('search_files')
    expect(result.suggestion).toContain('stop navigating and edit')
  })

  it('allows precise line-range reads', () => {
    const advisor = new ToolRoutingAdvisor()
    record(advisor, 'read_file', { path: 'src/a.ts' })

    expect(advisor.check([{
      id: '2',
      name: 'read_file',
      arguments: { path: 'src/b.ts', start_line: 20, end_line: 40 },
    }]).warning).toBeUndefined()
  })

  it('redirects shell-based file discovery before execution', () => {
    const advisor = new ToolRoutingAdvisor()
    const result = advisor.check([{
      id: '1',
      name: 'run_command',
      arguments: { command: 'Get-ChildItem -Recurse -File src' },
    }])

    expect(result.details).toMatchObject({ category: 'tool_routing', pattern: 'shell_file_discovery' })
    expect(result.suggestion).toContain('Reserve run_command for builds')
  })

  it('redirects a second recursive directory scan', () => {
    const advisor = new ToolRoutingAdvisor()
    record(advisor, 'list_directory', { path: '.', recursive: true })

    const result = advisor.check([{
      id: '2',
      name: 'list_directory',
      arguments: { path: 'src', recursive: true },
    }])

    expect(result.details).toMatchObject({ category: 'tool_routing', pattern: 'recursive_directory' })
  })
})
