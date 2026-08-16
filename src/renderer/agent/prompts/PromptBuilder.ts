/** Prompt builder for Agent and Plan modes. */

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
import { shellServerRoutingService } from '../services/shellServerRoutingService'
import { buildPlanProviderPromptSection } from '../plan/planProviderCatalog'

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
  remoteServerSection?: string | null
  /** 该提示词是否用于子代理（隐藏线程）。会剔除 task / ask_user / 计划类工具。 */
  isSubAgent?: boolean
}

function buildTools(
  mode: WorkMode,
  templateId?: string,
  planPhase?: 'planning' | 'executing',
  isSubAgent?: boolean
): string {
  const excludeCategories: ToolCategory[] = []
  const allowedTools = getToolsForContext({ mode, templateId, planPhase, isSubAgent })
  const sortedAllowedTools = allowedTools ? [...allowedTools].sort() : undefined
  const baseTools = generateToolsPromptDescriptionFiltered(excludeCategories, sortedAllowedTools)

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

function buildRemoteServerSection(section: string | null): string | null {
  if (!section?.trim()) return null
  return section.trim()
}

function buildModeRuntimeContract(ctx: PromptContext): string | null {
  if (ctx.mode !== 'plan' || ctx.isSubAgent) return null

  if (ctx.planPhase === 'executing') {
    return `## Plan Mode Runtime Contract — Execution Phase
- A reviewed plan already exists. Work through that plan and keep its task state accurate.
- Do not replace the approved plan with an unrelated ad-hoc todo list.
- Use report_plan_activity for meaningful fine-grained actions, findings, blockers, handoffs, and validation results. The title/detail must describe the actual work rather than a predefined frontend step.
- Do not report every trivial tool call. Runtime task state and approval state remain authoritative; never use activity reports to claim work completed early.
- Surface approval requests and blockers through the Plan execution UI.`
  }

  return `## Plan Mode Runtime Contract — Planning Phase (OVERRIDES generic autonomy rules)
- You are planning, not implementing. Do not behave like ordinary Agent mode.
- For every non-trivial request, first inspect the workspace, then explicitly check whether scope, acceptance criteria, UX behavior, constraints, and execution preferences are sufficiently clear.
- Use report_plan_activity when the meaningful focus changes or you discover a concrete constraint. Fine-grained activity text is generated by you; the UI only provides the requirements/plan/execution/validation containers.
- If any important decision is missing, you MUST call ask_user with one concise grouped question before creating the plan. Do not silently guess product decisions.
- When requirements are clear, you MUST call create_task_plan. Describing a plan only in prose is not completion.
- create_task_plan.stageContent is the versioned UI content model. Author all four stages (requirements, plan, execution, validation) from the actual request. Choose the sections and entries dynamically; never emit placeholder or generic filler.
- The task graph is authoritative for dependencies and scheduling. Stage content explains what each workspace stage should show; it must agree with the graph, assigned roles/models, expected artifacts, risks, and acceptance criteria.
- create_task_plan opens the TaskBoard automatically. After it succeeds, stop the loop so the user can review the board.
- Do not implement files or launch sub-agents during this phase.`
}

function buildSkillsSections(autoSkills: SkillItem[], mentionedSkills: SkillItem[]): (string | null)[] {
  const index = skillService.buildSkillsIndex(autoSkills) || null
  const fullContent = skillService.buildSkillsPrompt(mentionedSkills) || null
  return [index, fullContent]
}

export function buildSystemPrompt(
  ctx: PromptContext,
  options?: { includeRuntimeEnvironment?: boolean },
): string {
  const sections: (string | null)[] = [
    ctx.personality,
    APP_IDENTITY,
    PROFESSIONAL_OBJECTIVITY,
    SECURITY_RULES,
    buildTools(ctx.mode, ctx.templateId, ctx.planPhase, ctx.isSubAgent),
    CODE_CONVENTIONS,
    WORKFLOW_GUIDELINES,
    buildModeRuntimeContract(ctx),
    ctx.mode === 'plan' ? buildPlanProviderPromptSection() : null,
    OUTPUT_FORMAT,
    buildProjectSummary(ctx.projectSummary || null),
    buildProjectRules(ctx.projectRules),
    buildMemory(ctx.memories),
    ...buildSkillsSections(ctx.autoSkills, ctx.mentionedSkills),
    buildRemoteServerSection(ctx.remoteServerSection || null),
    buildCustomInstructions(ctx.customInstructions),
    options?.includeRuntimeEnvironment === false ? null : buildEnvironment(ctx),
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
    threadId?: string
    isSubAgent?: boolean
  }
): Promise<{
  prompt: string
  runtimeEnvironment: string
  activeSkills: { name: string; description: string }[]
}> {
  const {
    openFiles = [],
    activeFile,
    customInstructions,
    promptTemplateId,
    planPhase,
    mentionedSkills,
    threadId,
    isSubAgent,
  } = options || {}

  // Plan is a behavioral mode, not merely a tool filter. It must always use
  // the dedicated two-phase planner prompt; otherwise a selected coder/default
  // template receives plan tools but continues behaving like ordinary Agent mode.
  let template = resolvePromptTemplateForMode(mode, promptTemplateId, isSubAgent)

  if (!template) {
    logger.agent.warn(`[PromptBuilder] Template not found: ${promptTemplateId}, falling back to default.`)
    template = getDefaultPromptTemplate()
  }

  const [projectRules, memories, allSkills, projectSummary, remoteServerSection] = await Promise.all([
    rulesService.getRules(),
    memoryService.getMemories(),
    skillService.getSkills(),
    workspacePath ? loadProjectSummary(workspacePath) : Promise.resolve(null),
    shellServerRoutingService.getPromptSection(threadId),
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
    isSubAgent,
    remoteServerSection,
  }

  const prompt = buildSystemPrompt(ctx, { includeRuntimeEnvironment: false })
  const runtimeEnvironment = buildEnvironment(ctx)

  return {
    prompt,
    runtimeEnvironment,
    activeSkills: activeSkillsList.map(skill => ({
      name: skill.name,
      description: skill.description,
    })),
  }
}

export function resolvePromptTemplateForMode(mode: WorkMode, promptTemplateId?: string, isSubAgent?: boolean) {
  if (mode === 'plan' && !isSubAgent) {
    return getPromptTemplateById('plan') || getDefaultPromptTemplate()
  }
  return promptTemplateId
    ? getPromptTemplateById(promptTemplateId)
    : getDefaultPromptTemplate()
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
