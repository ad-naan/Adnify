/**
 * 上下文相关类型定义
 */

/** 上下文项类型 */
export type ContextItemType =
  | 'File'
  | 'CodeSelection'
  | 'Folder'
  | 'Codebase'
  | 'Git'
  | 'Terminal'
  | 'ShellServer'
  | 'Symbols'
  | 'Web'
  | 'Problems'
  | 'Skill'

export interface FileContext {
  type: 'File'
  uri: string
}

export interface CodeSelectionContext {
  type: 'CodeSelection'
  uri: string
  range: [number, number]
}

export interface FolderContext {
  type: 'Folder'
  uri: string
}

export interface CodebaseContext {
  type: 'Codebase'
  query?: string
}

export interface GitContext {
  type: 'Git'
}

export interface TerminalContext {
  type: 'Terminal'
}

export interface ShellServerContext {
  type: 'ShellServer'
  serverLinkId: string
  serverName: string
  host: string
  port?: number
  username?: string
  remotePath?: string
  bindingMode: 'explicit' | 'recent-memory'
}

export interface SymbolsContext {
  type: 'Symbols'
}

export interface WebContext {
  type: 'Web'
  query?: string
}

export interface ProblemsContext {
  type: 'Problems'
  uri?: string
}

export interface SkillContext {
  type: 'Skill'
  skillId: string
  name: string
  description?: string
  /** LLM 自动选中（非 @mention） */
  auto?: boolean
}

/** 上下文项联合类型 */
export type ContextItem =
  | FileContext
  | CodeSelectionContext
  | FolderContext
  | CodebaseContext
  | GitContext
  | TerminalContext
  | ShellServerContext
  | SymbolsContext
  | WebContext
  | ProblemsContext
  | SkillContext
