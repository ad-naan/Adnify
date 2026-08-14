import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, resolvePromptTemplateForMode, type PromptContext } from '@renderer/agent/prompts/PromptBuilder'

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
})
