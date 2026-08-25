import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, buildSystemPromptSections, resolvePromptTemplateForMode, type PromptContext } from '@renderer/agent/prompts/PromptBuilder'

describe('PromptBuilder', () => {
  it('forces the planner template for user-facing Plan mode', () => {
    expect(resolvePromptTemplateForMode('plan', 'coder', false)?.id).toBe('plan')
    expect(resolvePromptTemplateForMode('plan', 'concise', true)?.id).toBe('concise')
  })

  it('keeps task-list state out of the stable system prompt', () => {
    const prompt = buildSystemPrompt({
      os: 'Windows',
      workspacePath: 'E:\\Project\\adnify',
      activeFile: null,
      openFiles: [],
      date: '2026-04-20',
      mode: 'agent',
      personality: 'You are a helpful coding assistant.',
      projectRules: null,
      memories: [],
      autoSkills: [],
      mentionedSkills: [],
      customInstructions: null,
      templateId: 'default',
      projectSummary: null,
    } satisfies PromptContext)

    expect(prompt).not.toContain('## Current Task List')
    expect(prompt).not.toContain('do NOT recreate the list')
  })

  it('separates complete symbol edits from small local edits', () => {
    const prompt = buildSystemPrompt({
      os: 'Windows',
      workspacePath: 'E:\\Project\\adnify',
      activeFile: null,
      openFiles: [],
      date: '2026-08-24',
      mode: 'agent',
      personality: 'You are a coding assistant.',
      projectRules: null,
      memories: [],
      autoSkills: [],
      mentionedSkills: [],
      customInstructions: null,
      templateId: 'default',
      projectSummary: null,
    } satisfies PromptContext)

    expect(prompt).toContain('`find_symbol(include_body=true)` → `edit_symbol`')
    expect(prompt).toContain('Small local change or non-code/config edit')
    expect(prompt).not.toContain('use edit_file for any partial change to an existing file')
  })

  it('defines an action-first workflow with a progress invariant', () => {
    const prompt = buildSystemPrompt({
      os: 'Windows',
      workspacePath: 'E:\\Project\\adnify',
      activeFile: null,
      openFiles: [],
      date: '2026-08-25',
      mode: 'agent',
      personality: 'You are a coding assistant.',
      projectRules: null,
      memories: [],
      autoSkills: [],
      mentionedSkills: [],
      customInstructions: null,
      templateId: 'default',
      projectSummary: null,
    } satisfies PromptContext)

    expect(prompt).toContain('Answer, explain, review, diagnose, or report')
    expect(prompt).toContain('Change, build, fix, implement, or refactor')
    expect(prompt).toContain('Act as soon as the target and change are clear')
    expect(prompt).toContain('Every tool call must do at least one of these: narrow the target, change the workspace, or validate a change')
    expect(prompt).toContain('Tool descriptions are routing boundaries, not a checklist')
    expect(prompt).toContain('If validation fails, use the failure output to make the next fix')
  })

  it('uses one layered XML and Markdown contract without repeating native tool schemas', () => {
    const prompt = buildSystemPrompt({
      os: 'Windows',
      workspacePath: 'E:\\Project\\adnify',
      activeFile: 'src/main.ts',
      openFiles: ['src/main.ts'],
      date: '2026-08-25',
      mode: 'agent',
      personality: 'You are a coding assistant.',
      projectRules: { content: 'Use Vitest.', source: 'test', lastModified: 0 },
      memories: [],
      autoSkills: [],
      mentionedSkills: [],
      customInstructions: 'Keep public APIs stable.',
      templateId: 'default',
      projectSummary: 'TypeScript application.',
    } satisfies PromptContext)

    expect(prompt).toMatch(/^<adnify_agent>/)
    expect(prompt).toContain('<operating_contract>')
    expect(prompt).toContain('Adnify was created by adnaan')
    expect(prompt).toContain('https://github.com/ad-naan/adnify')
    expect(prompt).toContain('<mode_contract mode="agent">')
    expect(prompt).toContain('<tool_routing>')
    expect(prompt).toContain('| Need | Prefer | Boundary |')
    expect(prompt).toContain('<project_context priority="below_core_contract">')
    expect(prompt).toContain('<runtime_context>')
    expect(prompt).toMatch(/<project_rules>\s+Use Vitest\.\s+<\/project_rules>/)
    expect(prompt).not.toContain('**Parameters:**')
    expect(prompt).not.toContain('## Available Tools')
    expect(prompt.length).toBeLessThan(10_000)
  })

  it('does not mention unavailable write tools during plan exploration', () => {
    const prompt = buildSystemPrompt({
      os: 'Windows',
      workspacePath: 'E:\\Project\\adnify',
      activeFile: null,
      openFiles: [],
      date: '2026-08-25',
      mode: 'plan',
      planPhase: 'planning',
      personality: 'You are a planner.',
      projectRules: null,
      memories: [],
      autoSkills: [],
      mentionedSkills: [],
      customInstructions: null,
      templateId: 'plan',
      projectSummary: null,
    } satisfies PromptContext)

    expect(prompt).toContain('<mode_contract mode="plan" phase="planning">')
    expect(prompt).not.toContain('`edit_symbol`')
    expect(prompt).not.toContain('`edit_file`')
    expect(prompt).not.toContain('`write_file`')
  })

  it('exposes preview sections that recompose into the exact system prompt', () => {
    const context = {
      os: 'Windows',
      workspacePath: 'E:\\Project\\adnify',
      activeFile: 'src/main.ts',
      openFiles: ['src/main.ts'],
      date: '2026-08-25',
      mode: 'agent',
      personality: 'You are a coding assistant.',
      projectRules: { content: 'Use Vitest.', source: 'test', lastModified: 0 },
      memories: [],
      autoSkills: [],
      mentionedSkills: [],
      customInstructions: 'Keep public APIs stable.',
      templateId: 'default',
      projectSummary: 'TypeScript application.',
    } satisfies PromptContext

    const sections = buildSystemPromptSections(context)
    const recomposed = ['<adnify_agent>', ...sections.map(section => section.content), '</adnify_agent>'].join('\n\n')

    expect(recomposed).toBe(buildSystemPrompt(context))
    expect(sections.map(section => section.id)).toEqual([
      'role',
      'operating-contract',
      'mode-contract',
      'tool-routing',
      'response-contract',
      'project-context',
      'runtime-context',
    ])
    expect(sections.filter(section => !section.stable).map(section => section.id)).toEqual([
      'project-context',
      'runtime-context',
    ])
  })
})
