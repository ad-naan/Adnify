/**
 * 工具分组与按需加载
 * 
 * 架构设计：
 * - 工具组：按功能分组的工具集合
 * - 模式工具：不同工作模式（agent/chat）加载不同工具
 * - 角色工具：不同角色（模板）可以扩展额外工具
 * 
 * 加载规则：
 * - chat 模式：无工具
 * - agent 模式：core 工具组
 * - 角色扩展：在模式基础上添加角色专属工具组
 */

import type { WorkMode } from '@shared/types/workMode'

// ============================================
// 类型定义
// ============================================

/** 工具组配置 */
export interface ToolGroupConfig {
  id: string
  name: string
  tools: string[]
}

/** 工具加载上下文 */
export interface ToolLoadingContext {
  /** 工作模式 */
  mode: WorkMode
  /** 角色模板 ID（可选） */
  templateId?: string
  /** Plan 阶段：planning = 只有编排工具, executing = 所有工具 */
  planPhase?: 'planning' | 'executing'
  /**
   * 当前循环是否运行在子代理（隐藏线程）里。
   *
   * 子代理跑的是同一个 agent 模式，因此默认会拿到整个 CORE_TOOLS —— 其中包含
   * `task` 本身，也就是子代理可以再派生子代理，无限递归。置为 true 时
   * SUB_AGENT_EXCLUDED_TOOLS 会被剔除。
   *
   * 注意：这只负责「不把工具喂给模型」。真正的硬拦截在
   * SubAgentManager.spawn（按父线程 ID 判定），因为工具加载上下文是模块级单例，
   * 并发线程会互相覆盖，不能作为唯一防线。
   */
  isSubAgent?: boolean
}

/** 角色工具配置 */
export interface TemplateToolConfig {
  /** 角色需要的额外工具组 */
  toolGroups: string[]
}

// ============================================
// 工具组定义
// ============================================

/** 核心工具 - agent 模式使用 */
const CORE_TOOLS: string[] = [
  // 文件读取
  'read_file',
  'read_image',
  'list_directory',
  'search_files',
  // 文件编辑
  'edit_file',
  'write_file',
  'create_directory',
  'delete_file_or_folder',
  // 终端
  'run_command',
  'list_remote_directory',
  'read_remote_file',
  'write_remote_file',
  'rename_remote_path',
  'delete_remote_path',
  'upload_to_remote',
  'download_from_remote',
  'get_diagnostics',
  // 代码智能
  'find_symbol',
  'find_references',
  'navigate_symbol',
  'get_hover_info',
  'get_document_symbols',
  'edit_symbol',
  'rename_symbol',

  // 搜索
  'codebase_search',
  // 网络
  'web_search',
  'read_url',
  // 交互与记忆
  'remember',
  // Skill 按需加载
  'apply_skill',
  // 任务列表
  'todo_write',
  // Sub-agent 编排
  'task',
]

/** UI/UX 工具 - uiux-designer 角色专用 */
const UIUX_TOOLS: string[] = [
  'uiux_search',
  'uiux_recommend',
]

/** Plan 规划工具 - 仅用于需求收集、计划创建与计划修订 */
const PLAN_PLANNING_TOOLS: string[] = [
  'report_plan_activity',
  'ask_user',
  'create_task_plan',
  'update_task_plan',
]

/** Plan 执行控制工具 - 仅在进入执行阶段后可用 */
const PLAN_EXECUTION_CONTROL_TOOLS: string[] = [
  'start_task_execution',
]

const PLAN_EXPLORATION_TOOLS: string[] = [
  'read_file',
  'read_image',
  'list_directory',
  'search_files',
  'codebase_search',
  'find_symbol',
  'find_references',
  'navigate_symbol',
  'get_hover_info',
  'get_document_symbols',
  'get_diagnostics',
]

/**
 * 子代理不允许持有的工具。
 *
 * - `task`：子代理再派生子代理 = 无限递归。
 * - `ask_user`：子代理跑在隐藏线程上，提问没有 UI 可以承接，只会挂到超时。
 * - `create_task_plan` / `update_task_plan` / `start_task_execution`：
 *   规划是全局单例状态，子代理改它会踩到主 agent 正在执行的计划。
 */
const SUB_AGENT_EXCLUDED_TOOLS: readonly string[] = [
  'task',
  'ask_user',
  'create_task_plan',
  'update_task_plan',
  'start_task_execution',
]

/** 工具组注册表 */
const TOOL_GROUPS: Record<string, string[]> = {
  core: CORE_TOOLS,
  uiux: UIUX_TOOLS,
  plan: PLAN_PLANNING_TOOLS,
}

/** 角色工具配置注册表 */
const TEMPLATE_TOOLS: Record<string, TemplateToolConfig> = {
  'uiux-designer': { toolGroups: ['uiux'] },
}

// ============================================
// 工具组管理
// ============================================

/**
 * 注册工具组
 */
export function registerToolGroup(id: string, tools: string[]): void {
  TOOL_GROUPS[id] = tools
}

/**
 * 注册角色工具配置
 */
export function registerTemplateTools(templateId: string, config: TemplateToolConfig): void {
  TEMPLATE_TOOLS[templateId] = config
}

/**
 * 获取工具组
 */
export function getToolGroup(id: string): string[] | undefined {
  return TOOL_GROUPS[id]
}

// ============================================
// 工具加载
// ============================================

/**
 * 根据上下文获取工具列表
 *
 * 加载规则：
 * - agent: core 工具组
 * - plan: plan 规划工具组（动态活动、需求确认、计划创建与修订）
 * - 角色: 在模式基础上 + 角色专属工具组
 */
export function getToolsForContext(context: ToolLoadingContext): string[] {
  const tools = collectToolsForContext(context)
  if (!context.isSubAgent) return tools
  return tools.filter(tool => !SUB_AGENT_EXCLUDED_TOOLS.includes(tool))
}

function collectToolsForContext(context: ToolLoadingContext): string[] {
  // 收集工具（使用 Set 去重）
  const tools = new Set<string>()

  // plan 模式：根据阶段加载不同工具
  if (context.mode === 'plan') {
    // 执行阶段：加载所有工具（core + plan）以及执行控制工具
    if (context.planPhase === 'executing') {
      for (const tool of CORE_TOOLS) {
        tools.add(tool)
      }
      for (const tool of TOOL_GROUPS['plan'] || []) {
        tools.add(tool)
      }
      for (const tool of PLAN_EXECUTION_CONTROL_TOOLS) {
        tools.add(tool)
      }
      return Array.from(tools)
    }

    // 规划阶段（默认）：只使用探索工具和规划工具，不允许直接启动执行
    for (const tool of PLAN_EXPLORATION_TOOLS) {
      tools.add(tool)
    }
    for (const tool of TOOL_GROUPS['plan'] || []) {
      tools.add(tool)
    }
    return Array.from(tools)
  }

  // 1. Agent 模式：core 工具
  for (const tool of CORE_TOOLS) {
    tools.add(tool)
  }

  // 2. 添加角色专属工具
  if (context.templateId) {
    const templateConfig = TEMPLATE_TOOLS[context.templateId]
    if (templateConfig) {
      for (const groupId of templateConfig.toolGroups) {
        const groupTools = TOOL_GROUPS[groupId]
        if (groupTools) {
          for (const tool of groupTools) {
            tools.add(tool)
          }
        }
      }
    }
  }

  return Array.from(tools)
}

/**
 * 检查工具是否在上下文中可用
 */
export function isToolAvailable(toolName: string, context: ToolLoadingContext): boolean {
  return getToolsForContext(context).includes(toolName)
}
