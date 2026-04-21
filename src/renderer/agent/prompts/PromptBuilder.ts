/**
 * Prompt builder for agent and chat modes.
 */

import { WorkMode } from '@/renderer/modes/types'
import { generateToolsPromptDescriptionFiltered, type ToolCategory } from '@/shared/config/tools'
import { getToolsForContext } from '@/shared/config/toolGroups'
import { DEFAULT_AGENT_CONFIG } from '@shared/config/agentConfig'
import { PERFORMANCE_DEFAULTS } from '@shared/config/defaults'
import { rulesService, type ProjectRules } from '../services/rulesService'
import { memoryService, type MemoryItem } from '../services/memoryService'
import { skillService, type SkillItem } from '../services/skillService'
import {
  APP_IDENTITY,
  PROFESSIONAL_OBJECTIVITY,
  SECURITY_RULES,
  CODE_CONVENTIONS,
  WORKFLOW_GUIDELINES,
  OUTPUT_FORMAT,
  TOOL_GUIDELINES,
  getPromptTemplateById,
  getDefaultPromptTemplate,
} from './promptTemplates'
import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'

let projectSummaryCache: { path: string; summary: string; timestamp: number } | null = null
const SUMMARY_CACHE_TTL = 5 * 60 * 1000

async function loadProjectSummary(workspacePath: string): Promise<string | null> {
  try {
    if (
      projectSummaryCache &&
      projectSummaryCache.path === workspacePath &&
      Date.now() - projectSummaryCache.timestamp < SUMMARY_CACHE_TTL
    ) {
      logger.agent.info('[PromptBuilder] Using cached project summary')
      return projectSummaryCache.summary
    }

    const summary = await api.index.getProjectSummaryText(workspacePath)
    if (summary) {
      projectSummaryCache = { path: workspacePath, summary, timestamp: Date.now() }
      logger.agent.info('[PromptBuilder] Loaded project summary:', summary.slice(0, 200) + '...')
      return summary
    }

    logger.agent.info('[PromptBuilder] No project summary available')
    return null
  } catch (error) {
    logger.agent.info('[PromptBuilder] Failed to load project summary:', error)
    return null
  }
}

export const MAX_FILE_CHARS = DEFAULT_AGENT_CONFIG.maxFileContentChars
export const MAX_DIR_ITEMS = 150
export const MAX_SEARCH_RESULTS = PERFORMANCE_DEFAULTS.maxSearchResults
export const MAX_TERMINAL_OUTPUT = DEFAULT_AGENT_CONFIG.maxTerminalChars
export const MAX_CONTEXT_CHARS = DEFAULT_AGENT_CONFIG.maxTotalContextChars

export interface PromptContext {
  os: string
  workspacePath: string | null
  activeFile: string | null
  openFiles: string[]
  date: string
  mode: WorkMode
  personality: string
  projectRules: ProjectRules | null
  memories: MemoryItem[]
  autoSkills: SkillItem[]
  mentionedSkills: SkillItem[]
  customInstructions: string | null
  templateId?: string
  projectSummary?: string | null
  planPhase?: 'planning' | 'executing'
}

function buildTools(mode: WorkMode, templateId?: string, planPhase?: 'planning' | 'executing'): string {
  const excludeCategories: ToolCategory[] = []
  const allowedTools = getToolsForContext({ mode, templateId, planPhase })
  const baseTools = generateToolsPromptDescriptionFiltered(excludeCategories, allowedTools)

  return `## Available Tools

${baseTools}

${TOOL_GUIDELINES}`
}

function buildEnvironment(ctx: PromptContext): string {
  return `## Environment
- OS: ${ctx.os}
- Workspace: ${ctx.workspacePath || 'No workspace open'}
- Active File: ${ctx.activeFile || 'None'}
- Open Files: ${ctx.openFiles.length > 0 ? ctx.openFiles.join(', ') : 'None'}
- Date: ${ctx.date}`
}

function buildProjectRules(rules: ProjectRules | null): string | null {
  if (!rules?.content) return null
  return `## Project Rules
${rules.content}`
}

function buildMemory(memories: MemoryItem[]): string | null {
  const enabled = memories.filter(memory => memory.enabled)
  if (enabled.length === 0) return null

  const lines = enabled.map(memory => `- ${memory.content}`).join('\n')
  return `## Project Memory
${lines}`
}

function buildCustomInstructions(instructions: string | null): string | null {
  if (!instructions?.trim()) return null
  return `## Custom Instructions
${instructions.trim()}`
}

function buildProjectSummary(summary: string | null): string | null {
  if (!summary?.trim()) return null

  logger.agent.info('[PromptBuilder] Injecting project summary into system prompt, length:', summary.length)
  return `## Project Overview
${summary.trim()}

Note: This is an auto-generated project summary. Use it to understand the codebase structure before exploring files.`
}

function buildSkillsSections(autoSkills: SkillItem[], mentionedSkills: SkillItem[]): (string | null)[] {
  const index = skillService.buildSkillsIndex(autoSkills) || null
  const fullContent = skillService.buildSkillsPrompt(mentionedSkills) || null
  return [index, fullContent]
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const sections: (string | null)[] = [
    ctx.personality,
    APP_IDENTITY,
    PROFESSIONAL_OBJECTIVITY,
    SECURITY_RULES,
    buildTools(ctx.mode, ctx.templateId, ctx.planPhase),
    CODE_CONVENTIONS,
    WORKFLOW_GUIDELINES,
    OUTPUT_FORMAT,
    buildEnvironment(ctx),
    buildProjectSummary(ctx.projectSummary || null),
    buildProjectRules(ctx.projectRules),
    buildMemory(ctx.memories),
    ...buildSkillsSections(ctx.autoSkills, ctx.mentionedSkills),
    buildCustomInstructions(ctx.customInstructions),
  ]

  return sections.filter(Boolean).join('\n\n')
}

export function buildChatPrompt(ctx: PromptContext): string {
  const sections: (string | null)[] = [
    ctx.personality,
    APP_IDENTITY,
    PROFESSIONAL_OBJECTIVITY,
    SECURITY_RULES,
    CODE_CONVENTIONS,
    OUTPUT_FORMAT,
    buildEnvironment(ctx),
    buildProjectSummary(ctx.projectSummary || null),
    buildProjectRules(ctx.projectRules),
    buildMemory(ctx.memories),
    ...buildSkillsSections(ctx.autoSkills, ctx.mentionedSkills),
    buildCustomInstructions(ctx.customInstructions),
  ]

  return sections.filter(Boolean).join('\n\n')
}

export async function buildAgentSystemPrompt(
  mode: WorkMode,
  workspacePath: string | null,
  options?: {
    openFiles?: string[]
    activeFile?: string
    customInstructions?: string
    promptTemplateId?: string
    planPhase?: 'planning' | 'executing'
    mentionedSkills?: string[]
  }
): Promise<{ prompt: string; activeSkills: { name: string; description: string }[] }> {
  const {
    openFiles = [],
    activeFile,
    customInstructions,
    promptTemplateId,
    planPhase,
    mentionedSkills,
  } = options || {}

  let template = promptTemplateId
    ? getPromptTemplateById(promptTemplateId)
    : getDefaultPromptTemplate()

  if (!template) {
    logger.agent.warn(`[PromptBuilder] Template not found: ${promptTemplateId}, falling back to default.`)
    template = getDefaultPromptTemplate()
  }

  const [projectRules, memories, allSkills, projectSummary] = await Promise.all([
    rulesService.getRules(),
    memoryService.getMemories(),
    skillService.getSkills(),
    workspacePath ? loadProjectSummary(workspacePath) : Promise.resolve(null),
  ])

  const autoSkills = allSkills.filter(skill => skill.type === 'auto' && skill.enabled)
  const mentionedManualSkills = mentionedSkills?.length
    ? allSkills.filter(skill =>
        skill.type === 'manual' &&
        skill.enabled &&
        mentionedSkills.includes(skill.name.toLowerCase())
      )
    : []

  const activeSkillNames = new Set<string>()
  const activeSkillsList: typeof allSkills = []

  for (const skill of [...autoSkills, ...mentionedManualSkills]) {
    if (!activeSkillNames.has(skill.name)) {
      activeSkillNames.add(skill.name)
      activeSkillsList.push(skill)
    }
  }

  const ctx: PromptContext = {
    os: getOS(),
    workspacePath,
    activeFile: activeFile || null,
    openFiles,
    date: new Date().toLocaleDateString(),
    mode,
    personality: template.personality,
    projectRules,
    memories,
    autoSkills,
    mentionedSkills: mentionedManualSkills,
    customInstructions: customInstructions || null,
    templateId: template.id,
    projectSummary,
    planPhase,
  }

  const prompt = mode === 'chat' ? buildChatPrompt(ctx) : buildSystemPrompt(ctx)

  return {
    prompt,
    activeSkills: activeSkillsList.map(skill => ({
      name: skill.name,
      description: skill.description,
    })),
  }
}

function getOS(): string {
  if (typeof navigator !== 'undefined') {
    return navigator.userAgentData?.platform || navigator.platform || 'Unknown'
  }
  return 'Unknown'
}

export function formatUserMessage(
  message: string,
  context?: {
    selections?: Array<{
      type: 'file' | 'code' | 'folder'
      path: string
      content?: string
      range?: [number, number]
    }>
  }
): string {
  let formatted = message

  if (context?.selections && context.selections.length > 0) {
    const selectionsStr = context.selections
      .map(selection => {
        if (selection.type === 'code' && selection.content && selection.range) {
          return `**${selection.path}** (lines ${selection.range[0]}-${selection.range[1]}):\n\`\`\`\n${selection.content}\n\`\`\``
        }

        if (selection.type === 'file' && selection.content) {
          return `**${selection.path}**:\n\`\`\`\n${selection.content}\n\`\`\``
        }

        return `**${selection.path}**`
      })
      .join('\n\n')

    formatted += `\n\n---\n**Context:**\n${selectionsStr}`
  }

  return formatted
}

export function formatToolResult(toolName: string, result: string, success: boolean): string {
  return success ? result : `Error executing ${toolName}: ${result}`
}
