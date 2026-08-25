/** Prompt builder for Agent and Plan modes. */

import { WorkMode } from '@/renderer/modes/types'
import { getToolsForContext } from '@/shared/config/toolGroups'
import { DEFAULT_AGENT_CONFIG } from '@shared/config/agentConfig'
import { PERFORMANCE_DEFAULTS } from '@shared/config/defaults'
import { rulesService, type ProjectRules } from '../services/rulesService'
import { memoryService, type MemoryItem } from '../services/memoryService'
import { skillService, type SkillItem } from '../services/skillService'
import {
  getPromptTemplateById,
  getDefaultPromptTemplate,
} from './promptTemplates'
import {
  buildModeContract,
  buildOperatingContract,
  buildResponseContract,
  buildRoleContract,
  buildToolRoutingContract,
  type PromptContractContext,
} from './promptContract'
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

export type SystemPromptSectionGroup = 'core' | 'mode' | 'project' | 'runtime'

export interface SystemPromptSection {
  id: string
  group: SystemPromptSectionGroup
  content: string
  /** Stable sections are suitable for provider-side prompt caching. */
  stable: boolean
}

function getPromptContractContext(
  mode: WorkMode,
  templateId?: string,
  planPhase?: 'planning' | 'executing',
  isSubAgent?: boolean
): PromptContractContext {
  return {
    mode,
    planPhase,
    isSubAgent,
    allowedTools: getToolsForContext({ mode, templateId, planPhase, isSubAgent }),
  }
}

function buildEnvironment(ctx: PromptContext): string {
  return `<runtime_context>
## Environment
- OS: ${ctx.os}
- Workspace: ${ctx.workspacePath || 'No workspace open'}
- Active File: ${ctx.activeFile || 'None'}
- Open Files: ${ctx.openFiles.length > 0 ? ctx.openFiles.join(', ') : 'None'}
- Local Date: ${ctx.date}
</runtime_context>`
}

function buildProjectRules(rules: ProjectRules | null): string | null {
  if (!rules?.content) return null
  return `<project_rules>
${rules.content}
</project_rules>`
}

function buildMemory(memories: MemoryItem[]): string | null {
  const enabled = memories.filter(memory => memory.enabled)
  if (enabled.length === 0) return null

  const lines = enabled.map(memory => `- ${memory.content}`).join('\n')
  return `<project_memory>
${lines}
</project_memory>`
}

function buildCustomInstructions(instructions: string | null): string | null {
  if (!instructions?.trim()) return null
  return `<custom_instructions>
${instructions.trim()}
</custom_instructions>`
}

function buildProjectSummary(summary: string | null): string | null {
  if (!summary?.trim()) return null

  logger.agent.info('[PromptBuilder] Injecting project summary into system prompt, length:', summary.length)
  return `<project_overview source="generated">
${summary.trim()}

Use this generated overview as a starting point, then verify task-relevant details with tools.
</project_overview>`
}

function buildRemoteServerSection(section: string | null): string | null {
  if (!section?.trim()) return null
  return section.trim()
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
  const sections = buildSystemPromptSections(ctx, options)
  return ['<adnify_agent>', ...sections.map(section => section.content), '</adnify_agent>'].join('\n\n')
}

/**
 * Builds the exact ordered sections used by buildSystemPrompt.
 * Consumers such as the settings preview can inspect the prompt architecture
 * without parsing markup or maintaining a second representation.
 */
export function buildSystemPromptSections(
  ctx: PromptContext,
  options?: { includeRuntimeEnvironment?: boolean },
): SystemPromptSection[] {
  const contractContext = getPromptContractContext(
    ctx.mode,
    ctx.templateId,
    ctx.planPhase,
    ctx.isSubAgent,
  )
  const projectContext = [
    buildProjectSummary(ctx.projectSummary || null),
    buildProjectRules(ctx.projectRules),
    buildMemory(ctx.memories),
    ...buildSkillsSections(ctx.autoSkills, ctx.mentionedSkills),
    buildRemoteServerSection(ctx.remoteServerSection || null),
    buildCustomInstructions(ctx.customInstructions),
  ].filter(Boolean)
  const toolRouting = buildToolRoutingContract(contractContext)

  const sections: Array<SystemPromptSection | null> = [
    { id: 'role', group: 'core', stable: true, content: buildRoleContract(ctx.personality) },
    { id: 'operating-contract', group: 'core', stable: true, content: buildOperatingContract() },
    { id: 'mode-contract', group: 'mode', stable: true, content: buildModeContract(contractContext) },
    toolRouting
      ? { id: 'tool-routing', group: 'mode', stable: true, content: toolRouting }
      : null,
    { id: 'response-contract', group: 'core', stable: true, content: buildResponseContract() },
    ctx.mode === 'plan'
      ? { id: 'plan-providers', group: 'mode', stable: true, content: `<plan_providers>
${buildPlanProviderPromptSection()}
</plan_providers>` }
      : null,
    projectContext.length > 0
      ? { id: 'project-context', group: 'project', stable: false, content: `<project_context priority="below_core_contract">
${projectContext.join('\n\n')}
</project_context>` }
      : null,
    options?.includeRuntimeEnvironment === false
      ? null
      : { id: 'runtime-context', group: 'runtime', stable: false, content: buildEnvironment(ctx) },
  ]

  return sections.filter((section): section is SystemPromptSection => section !== null)
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
