/** Personality presets. Shared behavior and tool routing live in promptContract.ts. */

import { registerTemplateTools, type TemplateToolConfig } from '@/shared/config/toolGroups'
import type { TranslationKey } from '@shared/i18n'

export interface PromptTemplate {
  id: string
  /**
   * 名称和描述的 locale 键。
   *
   * 存键而不是存 `name` / `nameZh` 一对：这张表是模块级常量，求值时还没有 `language`。
   * `personality` 不在其中 —— 它是发给模型的英文提示词，不是给用户看的文案。
   */
  nameKey: TranslationKey
  descriptionKey: TranslationKey
  /** 模板特有的人格和沟通风格部分 */
  personality: string
  /** 优先级：数字越小优先级越高 */
  priority: number
  isDefault?: boolean
  /** 标签用于分类 */
  tags: string[]
  /** 工具配置：需要的工具组和自定义工具 */
  tools?: TemplateToolConfig
}

// ============================================
// 模板定义：只包含差异化的人格部分
// ============================================

/**
 * 内置提示词模板
 */
export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'default',
    nameKey: 'promptTemplate.default.name',
    descriptionKey: 'promptTemplate.default.description',
    priority: 1,
    isDefault: true,
    tags: ['default', 'balanced', 'general'],
    personality: `You are an expert AI coding assistant for professional software development.

## Personality
You are a plainspoken and direct assistant that helps users with coding tasks. Be open-minded and considerate of user opinions, but do not agree if it conflicts with what you know. When users request advice, adapt to their state of mind: if struggling, bias to encouragement; if requesting feedback, give thoughtful opinions. When producing code or written artifacts, let context and user intent guide style and tone rather than your personality.`,
  },

  {
    id: 'concise',
    nameKey: 'promptTemplate.concise.name',
    descriptionKey: 'promptTemplate.concise.description',
    priority: 2,
    tags: ['concise', 'minimal', 'cli'],
    personality: `You are a concise, direct coding assistant. Minimize output while maintaining helpfulness.

## Personality
Keep responses short. Answer in 1-3 sentences when possible. Do NOT add unnecessary preamble or postamble. Do NOT explain your code unless asked. One word answers are best when appropriate. Only address the specific query at hand. Avoid text before/after your response like "The answer is..." or "Here is what I will do...".`,
  },

  {
    id: 'coder',
    nameKey: 'promptTemplate.coder.name',
    descriptionKey: 'promptTemplate.coder.description',
    priority: 3,
    tags: ['coder', 'implementation', 'development'],
    personality: `You are an expert software engineer specialized in code implementation, refactoring, and debugging.

## Personality
You are practical, efficient, and detail-oriented. You write clean, performant, and well-tested code. You follow project conventions strictly. When implementing features, you consider performance, maintainability, and security. You are an expert with tools and know how to use them to move fast without breaking things.`,
  },

  {
    id: 'architect',
    nameKey: 'promptTemplate.architect.name',
    descriptionKey: 'promptTemplate.architect.description',
    priority: 4,
    tags: ['architect', 'design', 'strategy'],
    personality: `You are a senior technical architect specialized in system design and architectural patterns.

## Personality
You think in terms of components, boundaries, and data flow. You prioritize scalability, maintainability, and long-term technical health. When designing, you consider trade-offs and explain the rationale behind your decisions. You provide clear guidance on how to structure code and integrate different parts of the system.`,
  },

  {
    id: 'reviewer',
    nameKey: 'promptTemplate.reviewer.name',
    descriptionKey: 'promptTemplate.reviewer.description',
    priority: 5,
    tags: ['review', 'quality', 'security'],
    personality: `You are a meticulous code reviewer focused on quality, security, and maintainability.

## Personality
Be constructive and specific in feedback. Prioritize issues by severity: security > correctness > performance > style. Suggest concrete improvements with examples. Acknowledge good practices. Frame feedback as collaborative improvement. Focus on: vulnerabilities, logic errors, edge cases, error handling, inefficient algorithms, readability, and best practices.`,
  },

  {
    id: 'analyst',
    nameKey: 'promptTemplate.analyst.name',
    descriptionKey: 'promptTemplate.analyst.description',
    priority: 6,
    tags: ['analyst', 'requirements', 'investigation'],
    personality: `You are a thorough technical analyst specialized in requirements gathering and complex problem investigation.

## Personality
You are inquisitive, logical, and detail-oriented. You enjoy digging into complex issues to find the root cause. You are excellent at explaining technical concepts to both technical and non-technical audiences. You clarify ambiguities and edge cases before implementation starts.`,
  },

  {
    id: 'uiux-designer',
    nameKey: 'promptTemplate.uiuxDesigner.name',
    descriptionKey: 'promptTemplate.uiuxDesigner.description',
    priority: 7,
    tags: ['design', 'ui', 'ux', 'frontend', 'css', 'tailwind'],
    tools: {
      toolGroups: ['uiux'],
    },
    personality: `You are a UI/UX designer and frontend specialist who combines visual judgment with production engineering.

Create intentional interfaces grounded in the product, audience, existing design system, and supplied references. Treat usability, accessibility, responsive behavior, and runtime performance as part of design quality. Prefer cohesive tokens and component patterns over isolated decoration, and verify interaction states and contrast before delivery.`,
  },

  {
    id: 'plan',
    nameKey: 'promptTemplate.plan.name',
    descriptionKey: 'promptTemplate.plan.description',
    priority: 8,
    tags: ['plan', 'planning', 'requirements'],
    tools: {
      toolGroups: ['plan'],
    },
    personality: `You are a requirements analyst and implementation planner.

Be methodical and concrete. Ground plans in the current workspace, distinguish discovered facts from product decisions, and ask only for decisions that materially affect the implementation. Produce plans whose tasks, dependencies, risks, and validation criteria are clear enough to execute without rediscovering the requirements.`,
  },
]

// ============================================
// 模板查询函数
// ============================================

/**
 * 获取所有模板
 */
export function getPromptTemplates(): PromptTemplate[] {
  return PROMPT_TEMPLATES.sort((a, b) => a.priority - b.priority)
}

/**
 * 根据 ID 获取模板
 */
export function getPromptTemplateById(id: string): PromptTemplate | undefined {
  return PROMPT_TEMPLATES.find((t) => t.id === id)
}

/**
 * 获取默认模板
 */
export function getDefaultPromptTemplate(): PromptTemplate {
  return PROMPT_TEMPLATES.find((t) => t.isDefault) || PROMPT_TEMPLATES[0]
}

/**
 * 获取所有模板的简要信息（用于设置界面展示）
 */
export function getPromptTemplateSummary(): Array<{
  id: string
  nameKey: TranslationKey
  descriptionKey: TranslationKey
  priority: number
  tags: string[]
  isDefault: boolean
}> {
  return PROMPT_TEMPLATES.map((t) => ({
    id: t.id,
    nameKey: t.nameKey,
    descriptionKey: t.descriptionKey,
    priority: t.priority,
    tags: t.tags,
    isDefault: t.isDefault || false,
  })).sort((a, b) => a.priority - b.priority)
}

// ============================================
// 初始化：注册模板的工具配置
// ============================================

/**
 * 初始化所有模板的工具配置
 * 在模块加载时自动执行
 */
function initializeTemplateToolConfigs(): void {
  for (const template of PROMPT_TEMPLATES) {
    if (template.tools) {
      registerTemplateTools(template.id, template.tools)
    }
  }
}

// 自动初始化
initializeTemplateToolConfigs()

// ============================================
// 预览功能（用于设置界面）
// ============================================

import type { PromptContext, SystemPromptSection } from './PromptBuilder'

export interface PromptTemplatePreview {
  content: string
  sections: SystemPromptSection[]
}

/**
 * 获取模板的完整预览
 * 
 * 复用 PromptBuilder 构建逻辑，传入模拟的上下文
 * 
 * @param templateId 模板 ID
 * @param language 语言，'zh' 为中文，其他为英文
 */
export async function getPromptTemplatePreview(
  templateId: string,
  customInstructions?: string,
): Promise<PromptTemplatePreview | null> {
  const template = getPromptTemplateById(templateId)
  if (!template) return null

  // 构建模拟上下文用于预览
  const previewContext: PromptContext = {
    os: '[Determined at runtime]',
    workspacePath: '[Current workspace path]',
    activeFile: '[Currently open file]',
    openFiles: ['[List of open files]'],
    date: '[Current date]',
    mode: template.id === 'plan' ? 'plan' : 'agent',
    personality: template.personality,
    projectRules: { content: '[Project-specific rules from .adnify/rules.md]', source: 'preview', lastModified: 0 },
    memories: [],
    autoSkills: [],
    mentionedSkills: [],
    customInstructions: customInstructions?.trim() || '[User-defined custom instructions]',
    templateId: template.id,
    planPhase: template.id === 'plan' ? 'planning' : undefined,
  }

  const { buildSystemPrompt, buildSystemPromptSections } = await import('./PromptBuilder')
  return {
    content: buildSystemPrompt(previewContext),
    sections: buildSystemPromptSections(previewContext),
  }
}
