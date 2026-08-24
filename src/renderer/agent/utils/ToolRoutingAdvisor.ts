import type { LLMToolCall } from '@/shared/types'

type RoutingCategory = 'semantic_navigation' | 'tool_routing'

export function isInternalToolRoutingCategory(category: string | undefined): category is RoutingCategory {
  return category === 'semantic_navigation' || category === 'tool_routing'
}

export interface ToolRoutingAdvice {
  isLoop: false
  warning?: string
  suggestion?: string
  details?: {
    category: RoutingCategory
    toolName?: string
    count?: number
    threshold?: number
    target?: string | null
    pattern?: string
  }
}

interface ToolRecord {
  name: string
  args: Record<string, unknown>
  signature: string
  targets: string[]
  success: boolean
}

const NAVIGATION_TOOLS = new Set([
  'find_symbol',
  'get_document_symbols',
  'find_references',
  'navigate_symbol',
  'search_files',
  'codebase_search',
])

const SEMANTIC_TOOLS = new Set([
  'find_symbol',
  'get_document_symbols',
  'find_references',
  'navigate_symbol',
  'get_hover_info',
])

const SOURCE_EXTENSIONS = new Set([
  'c', 'cc', 'cpp', 'cs', 'dart', 'ex', 'exs', 'fs', 'go', 'h', 'hpp', 'java', 'js', 'jsx',
  'kt', 'kts', 'lua', 'php', 'py', 'rb', 'rs', 'scala', 'swift', 'ts', 'tsx', 'vue', 'svelte', 'zig',
])

const FILE_DISCOVERY_COMMAND = /^\s*(?:get-childitem|gci|find|rg|grep|cat|head|tail)\b/i

function stringPaths(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  return typeof value === 'string' ? [value] : []
}

function isSourcePath(path: string): boolean {
  const clean = path.split(/[?#]/, 1)[0]
  return SOURCE_EXTENSIONS.has(clean.slice(clean.lastIndexOf('.') + 1).toLowerCase())
}

function createRecord(toolCall: Pick<LLMToolCall, 'name' | 'arguments'>, success: boolean): ToolRecord {
  const args = (toolCall.arguments || {}) as Record<string, unknown>
  return {
    name: toolCall.name,
    args,
    signature: `${toolCall.name}:${JSON.stringify(args)}`,
    targets: stringPaths(args.paths ?? args.path),
    success,
  }
}

/** Advises before broad discovery calls execute; semantic failures explicitly unlock read/search fallback. */
export class ToolRoutingAdvisor {
  private history: ToolRecord[] = []
  private advisedSignatures = new Set<string>()

  check(toolCalls: LLMToolCall[]): ToolRoutingAdvice {
    const projected = [...this.history]

    for (const toolCall of toolCalls) {
      const record = createRecord(toolCall, true)
      const advice = this.checkRecord(record, projected)
      if (advice.warning && !this.advisedSignatures.has(record.signature)) {
        this.advisedSignatures.add(record.signature)
        return advice
      }
      projected.push(record)
    }

    return { isLoop: false }
  }

  recordExecutedTool(toolCall: Pick<LLMToolCall, 'name' | 'arguments'>, success: boolean): void {
    this.history.push(createRecord(toolCall, success))
    if (this.history.length > 80) this.history = this.history.slice(-80)
  }

  private checkRecord(record: ToolRecord, history: ToolRecord[]): ToolRoutingAdvice {
    if (record.name === 'run_command') {
      const command = typeof record.args.command === 'string' ? record.args.command : ''
      if (FILE_DISCOVERY_COMMAND.test(command)) {
        return {
          isLoop: false,
          warning: 'A shell command is being used only to enumerate, search, or read project files.',
          suggestion: 'Use find_symbol/get_document_symbols for code structure, search_files for exact text, or list_directory for filesystem layout. Reserve run_command for builds, tests, and programs.',
          details: { category: 'tool_routing', toolName: record.name, target: command, pattern: 'shell_file_discovery' },
        }
      }
    }

    if (record.name === 'list_directory' && record.args.recursive === true) {
      const previousRecursiveList = history.some(item => item.success && item.name === 'list_directory' && item.args.recursive === true)
      if (previousRecursiveList) {
        return {
          isLoop: false,
          warning: 'A second recursive directory listing would repeat broad project discovery.',
          suggestion: 'Use find_symbol/get_document_symbols for code structure or search_files for an exact name after the first project overview.',
          details: { category: 'tool_routing', toolName: record.name, target: record.targets[0] || null, pattern: 'recursive_directory' },
        }
      }
    }

    if (record.name !== 'read_file' || record.args.start_line !== undefined || record.args.end_line !== undefined) {
      return { isLoop: false }
    }
    if (!record.targets.some(isSourcePath)) return { isLoop: false }

    let lastSuccessfulNavigation = -1
    for (let index = history.length - 1; index >= 0; index--) {
      if (history[index].success && NAVIGATION_TOOLS.has(history[index].name)) {
        lastSuccessfulNavigation = index
        break
      }
    }
    let lastSemanticFailure = -1
    for (let index = history.length - 1; index > lastSuccessfulNavigation; index--) {
      if (!history[index].success && SEMANTIC_TOOLS.has(history[index].name)) {
        lastSemanticFailure = index
        break
      }
    }
    const navigationWindow = history.slice(Math.max(lastSuccessfulNavigation, lastSemanticFailure) + 1)

    const priorFullSourceReads = navigationWindow.filter(item =>
      item.success
      && item.name === 'read_file'
      && item.args.start_line === undefined
      && item.args.end_line === undefined
      && item.targets.some(isSourcePath)
    )
    if (priorFullSourceReads.length === 0) return { isLoop: false }

    const fallbackMode = lastSemanticFailure > lastSuccessfulNavigation
    return {
      isLoop: false,
      warning: 'Another whole source file is about to be read without a targeted navigation step.',
      suggestion: fallbackMode
        ? 'Semantic navigation failed, so use search_files to locate exact text and then read only the matching file range.'
        : 'Known symbol: use find_symbol. Known file but unknown structure: use get_document_symbols(depth=0). Exact text: use search_files. Read only the final file or line range after locating the target.',
      details: {
        category: 'semantic_navigation',
        toolName: record.name,
        count: priorFullSourceReads.length + 1,
        threshold: 2,
        target: record.targets.join(', '),
        pattern: fallbackMode ? 'fallback_source_read_burst' : 'whole_source_read_burst',
      },
    }
  }
}
