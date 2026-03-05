/**
 * 工具统一配置
 * 
 * 设计参考：Claude Code CLI, Codex CLI, Kiro
 * 
 * 单一数据源：所有工具的定义、schema、元数据、提示词描述都从这里生成
 * 添加新工具只需在 TOOL_CONFIGS 中添加一项
 */

import { z } from 'zod'
import type { ToolApprovalType } from '@/shared/types/llm'

// ============================================
// 类型定义
// ============================================

export type ToolCategory = 'read' | 'write' | 'terminal' | 'search' | 'lsp' | 'network' | 'interaction' | 'orchestrator'

export interface ToolPropertyDef {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object'
    description: string
    required?: boolean
    default?: unknown
    enum?: string[]
    items?: ToolPropertyDef
    properties?: Record<string, ToolPropertyDef>
}

export interface ToolConfig {
    name: string
    displayName: string
    /** 简短描述（用于 LLM 工具定义） */
    description: string
    /** 详细描述（用于系统提示词） */
    detailedDescription?: string
    /** 使用示例 */
    examples?: string[]
    /** 重要提示（CRITICAL/IMPORTANT 级别的规则） */
    criticalRules?: string[]
    /** 常见错误及解决方案 */
    commonErrors?: Array<{ error: string; solution: string }>
    category: ToolCategory
    approvalType: ToolApprovalType
    parallel: boolean
    requiresWorkspace: boolean
    enabled: boolean
    parameters: Record<string, ToolPropertyDef>
    /** 自定义 Zod schema（可选，用于复杂验证） */
    customSchema?: z.ZodSchema
    /** 自定义验证函数 */
    validate?: (data: Record<string, unknown>) => { valid: boolean; error?: string }
}

// ============================================
// 工具配置
// ============================================

export const TOOL_CONFIGS: Record<string, ToolConfig> = {
    // ===== 读取类工具 =====
    read_file: {
        name: 'read_file',
        displayName: 'Read File',
        description: 'Read one or more files with line numbers. Pass a single path string or an array of paths. For large files, use start_line/end_line. MUST read before editing.',
        detailedDescription: `Read file contents from the filesystem with line numbers (1-indexed).
- Single file: path="src/main.ts"
- Multiple files: path=["src/a.ts", "src/b.ts"]
- Large files will be truncated, use search_files to locate target first`,
        category: 'read',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: {
                type: 'string',
                description: 'File path (string) or multiple paths (array). Examples: "src/main.ts" or ["src/a.ts", "src/b.ts"]',
                required: true
            },
            start_line: { type: 'number', description: 'Starting line for single file (1-indexed)' },
            end_line: { type: 'number', description: 'Ending line for single file (inclusive)' },
        },
        validate: (data) => {
            if (data.start_line && data.end_line && (data.start_line as number) > (data.end_line as number)) {
                return { valid: false, error: 'start_line must be <= end_line' }
            }
            return { valid: true }
        },
    },

    list_directory: {
        name: 'list_directory',
        displayName: 'List Directory',
        description: 'List directory contents. Use recursive=true for tree view of subdirectories. Use recursive=false (default) for single level.',
        detailedDescription: `List directory contents with file types and sizes.
- Non-recursive: shows immediate children only
- Recursive: shows full tree up to max_depth`,
        category: 'read',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'Directory path relative to workspace root. Use "." for workspace root', required: true },
            recursive: { type: 'boolean', description: 'Show subdirectories recursively (default: false)', default: false },
            max_depth: { type: 'number', description: 'Maximum depth for recursive listing (default: 3)', default: 3 },
        },
    },

    // ===== 搜索工具 =====
    search_files: {
        name: 'search_files',
        displayName: 'Search Files',
        description: 'Search for text or regex patterns in files. Can search a directory or single file. Use | to combine multiple patterns in one call (e.g., "pattern1|pattern2"). For semantic search, use codebase_search instead.',
        detailedDescription: `Fast content search using ripgrep-style matching.
- Supports regex patterns with is_regex=true
- Use | to combine multiple patterns
- Can search single file by providing file path`,
        examples: [
            'search_files path="src" pattern="TODO|FIXME|HACK" is_regex=true',
            'search_files path="src/app.tsx" pattern="useState|useEffect" is_regex=true',
        ],
        criticalRules: [
            'Combine multiple patterns with | - NEVER make separate calls',
            'For single file, use file path directly as path parameter',
        ],
        category: 'search',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: {
                type: 'string',
                description: 'Directory OR file path relative to workspace root. Defaults to "." (workspace root).',
                default: '.'
            },
            pattern: { type: 'string', description: 'Pattern. Combine multiple with | (e.g., "pat1|pat2|pat3")', required: true },
            is_regex: { type: 'boolean', description: 'Enable regex (auto-enabled for | patterns)', default: false },
            file_pattern: { type: 'string', description: 'Filter files (e.g., "*.ts")' },
        },
    },

    codebase_search: {
        name: 'codebase_search',
        displayName: 'Semantic Search',
        description: 'AI-powered semantic search for finding code by meaning. Use for conceptual queries like "where is authentication handled". For exact text search, use search_files instead.',
        detailedDescription: `AI-powered semantic search for finding related code by meaning.
- Understands natural language queries
- Ask complete questions for best results`,
        examples: [
            'codebase_search query="user authentication logic"',
        ],
        criticalRules: [
            'Use complete questions for best results',
            'For exact text, use search_files instead',
        ],
        category: 'search',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            query: { type: 'string', description: 'Natural language query - ask complete question', required: true },
            top_k: { type: 'number', description: 'Number of results (default: 10)', default: 10 },
        },
    },

    // ===== 编辑类工具 =====
    edit_file: {
        name: 'edit_file',
        displayName: 'Edit File',
        description: 'Edit file by replacing text or line ranges. Three modes: 1) String replacement: old_string + new_string. 2) Line replacement: start_line + end_line + content. 3) Batch mode: edits array for multiple changes. CRITICAL: Must read_file first.',
        detailedDescription: `Three editing modes:
- String mode: old_string + new_string (include 3-5 lines context)
- Line mode: start_line + end_line + content (use line numbers from read_file)
- Batch mode: edits=[{action, start_line, end_line, content}, ...] (auto-sorted, prevents line number shifts)`,
        commonErrors: [
            { error: 'old_string not found', solution: 'Read file again, copy exact content' },
            { error: 'Multiple matches', solution: 'Include more context lines' },
            { error: 'Overlapping edits', solution: 'Ensure edit ranges do not overlap' },
        ],
        category: 'write',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root', required: true },
            old_string: { type: 'string', description: 'Text to find (string mode, include 3-5 lines context)' },
            new_string: { type: 'string', description: 'Replacement text (string mode)' },
            start_line: { type: 'number', description: 'Start line (line mode, 1-indexed)' },
            end_line: { type: 'number', description: 'End line (line mode, inclusive)' },
            content: { type: 'string', description: 'New content (line mode)' },
            replace_all: { type: 'boolean', description: 'Replace all occurrences (string mode)', default: false },
            edits: { 
                type: 'array', 
                description: 'Batch edits array (batch mode). Each edit: {action: "replace"|"insert"|"delete", start_line?, end_line?, after_line?, content?}. Auto-sorted to prevent line shifts.' 
            },
        },
        validate: (data) => {
            // 验证模式选择
            const hasStringMode = data.old_string || data.new_string
            const hasLineMode = data.start_line || data.end_line || data.content
            const hasBatchMode = data.edits

            const modeCount = [hasStringMode, hasLineMode, hasBatchMode].filter(Boolean).length
            if (modeCount > 1) {
                return { valid: false, error: 'Cannot mix string mode, line mode, and batch mode parameters' }
            }

            if (modeCount === 0) {
                return { valid: false, error: 'Must provide either (old_string + new_string), (start_line + end_line + content), or (edits array)' }
            }

            // 验证字符串模式
            if (hasStringMode && (!data.old_string || data.new_string === undefined)) {
                return { valid: false, error: 'String mode requires both old_string and new_string' }
            }

            // 验证行模式
            if (hasLineMode) {
                if (!data.start_line || !data.end_line || data.content === undefined) {
                    return { valid: false, error: 'Line mode requires start_line, end_line, and content' }
                }
                if ((data.start_line as number) > (data.end_line as number)) {
                    return { valid: false, error: 'start_line must be <= end_line' }
                }
            }

            // 验证批量模式
            if (hasBatchMode) {
                if (!Array.isArray(data.edits) || data.edits.length === 0) {
                    return { valid: false, error: 'Batch mode requires non-empty edits array' }
                }
                
                for (let i = 0; i < data.edits.length; i++) {
                    const edit = data.edits[i]
                    if (!edit.action || !['replace', 'insert', 'delete'].includes(edit.action)) {
                        return { valid: false, error: `Edit ${i}: action must be "replace", "insert", or "delete"` }
                    }
                    
                    if (edit.action === 'replace' || edit.action === 'delete') {
                        if (!edit.start_line || !edit.end_line) {
                            return { valid: false, error: `Edit ${i}: ${edit.action} requires start_line and end_line` }
                        }
                        if (edit.start_line > edit.end_line) {
                            return { valid: false, error: `Edit ${i}: start_line must be <= end_line` }
                        }
                    }
                    
                    if (edit.action === 'insert') {
                        if (edit.after_line === undefined) {
                            return { valid: false, error: `Edit ${i}: insert requires after_line` }
                        }
                    }
                    
                    if ((edit.action === 'replace' || edit.action === 'insert') && edit.content === undefined) {
                        return { valid: false, error: `Edit ${i}: ${edit.action} requires content` }
                    }
                }
            }

            return { valid: true }
        },
    },

    write_file: {
        name: 'write_file',
        displayName: 'Write File',
        description: 'Create new file or completely overwrite existing file. WARNING: This replaces entire file content. For partial edits, use edit_file instead.',
        detailedDescription: `Write complete file content.
- Creates new file if doesn't exist
- OVERWRITES entire file if exists`,
        criticalRules: [
            'OVERWRITES entire file - use edit_file for partial changes',
        ],
        category: 'write',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root (e.g., "src/new.ts")', required: true },
            content: { type: 'string', description: 'Complete file content', required: true },
        },
    },

    create_file_or_folder: {
        name: 'create_file_or_folder',
        displayName: 'Create',
        description: 'Create file or folder. Path ending with / creates folder.',
        detailedDescription: `Create new files or directories.
- Path ending with "/" creates folder
- Can include initial content for files`,
        examples: [
            'create_file_or_folder path="src/utils/"',
            'create_file_or_folder path="src/config.ts" content="export default {}"',
        ],
        category: 'write',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'Path relative to workspace root (end with / for folder, e.g., "src/utils/" or "src/config.ts")', required: true },
            content: { type: 'string', description: 'Initial content for files' },
        },
    },

    delete_file_or_folder: {
        name: 'delete_file_or_folder',
        displayName: 'Delete',
        description: 'Delete file or folder. Requires approval.',
        detailedDescription: `Delete files or directories.
- Requires user approval
- Use recursive=true for non-empty folders`,
        criticalRules: [
            'DESTRUCTIVE - requires approval',
        ],
        category: 'write',
        approvalType: 'dangerous',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'Path relative to workspace root to delete (e.g., "src/old.ts")', required: true },
            recursive: { type: 'boolean', description: 'Delete folder contents', default: false },
        },
    },

    // ===== 终端工具 =====
    run_command: {
        name: 'run_command',
        displayName: 'Run Command',
        description: 'Execute shell command. Requires user approval. Use cwd parameter to set working directory. Do NOT use for reading files (use read_file), searching (use search_files), or editing (use edit_file).',
        detailedDescription: `Execute shell commands in workspace.
- Requires user approval
- Use cwd parameter instead of cd commands`,
        examples: [
            'run_command command="npm install"',
            'run_command command="npm test" cwd="packages/core"',
        ],
        criticalRules: [
            'NEVER use cat/grep/sed - use dedicated tools',
            'Use cwd parameter instead of cd',
        ],
        category: 'terminal',
        approvalType: 'terminal',
        parallel: false,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            command: { type: 'string', description: 'Shell command', required: true },
            cwd: { type: 'string', description: 'Working directory relative to workspace root (e.g., "packages/core", NOT "./packages/core")', },
            timeout: { type: 'number', description: 'Timeout seconds (default: 30)', default: 30 },
            is_background: { type: 'boolean', description: 'Run in background', default: false },
        },
    },

    // ===== LSP 工具 =====
    get_lint_errors: {
        name: 'get_lint_errors',
        displayName: 'Lint Errors',
        description: 'Get TypeScript/ESLint errors for a file. Use after editing to verify code. Call once per file.',
        detailedDescription: `Get diagnostics (errors, warnings) for a file.
- Shows TypeScript/ESLint errors
- Use after editing to verify code`,
        criticalRules: [
            'Call once after editing, not repeatedly',
        ],
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root to check (e.g., "src/main.ts")', required: true },
        },
    },

    find_references: {
        name: 'find_references',
        displayName: 'Find References',
        description: 'Find all references to symbol at position.',
        detailedDescription: `Find all usages of a symbol across codebase.
- Requires exact file position (line, column)
- Useful for refactoring`,
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root (e.g., "src/main.ts")', required: true },
            line: { type: 'number', description: 'Line number (1-indexed)', required: true },
            column: { type: 'number', description: 'Column number (1-indexed)', required: true },
        },
    },

    go_to_definition: {
        name: 'go_to_definition',
        displayName: 'Go to Definition',
        description: 'Get definition location of symbol.',
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root (e.g., "src/main.ts")', required: true },
            line: { type: 'number', description: 'Line number (1-indexed)', required: true },
            column: { type: 'number', description: 'Column number (1-indexed)', required: true },
        },
    },

    get_hover_info: {
        name: 'get_hover_info',
        displayName: 'Hover Info',
        description: 'Get type info and docs for symbol.',
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root (e.g., "src/main.ts")', required: true },
            line: { type: 'number', description: 'Line number (1-indexed)', required: true },
            column: { type: 'number', description: 'Column number (1-indexed)', required: true },
        },
    },

    get_document_symbols: {
        name: 'get_document_symbols',
        displayName: 'Document Symbols',
        description: 'List all functions, classes, interfaces, and variables defined in a file. Use to understand file structure.',
        detailedDescription: `List all symbols defined in a file.
- Shows functions, classes, interfaces, variables`,
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root (e.g., "src/main.ts")', required: true },
        },
    },

    // ===== AI 辅助工具 =====
    analyze_code: {
        name: 'analyze_code',
        displayName: 'AI Code Analysis',
        description: `Use AI to analyze code and get structured diagnostics, suggestions, and insights.

### 🎯 WHEN TO USE
- Before refactoring: understand code structure and potential issues
- After reading complex code: get AI insights on quality and patterns
- When planning changes: identify risks and dependencies

### ⚠️ IMPORTANT
- This uses AI analysis (costs tokens), use sparingly
- For compile errors, use get_lint_errors instead (faster, free)
- Best for: architecture review, code quality, refactoring planning`,
        detailedDescription: `AI-powered code analysis that returns structured results:
- Issues: errors, warnings, code smells with severity and location
- Suggestions: refactoring opportunities with priority
- Summary: overall code quality assessment

Use this for deeper insights beyond what LSP provides.`,
        category: 'lsp',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path to analyze', required: true },
        },
    },

    suggest_refactoring: {
        name: 'suggest_refactoring',
        displayName: 'AI Refactoring Suggestions',
        description: `Get AI-powered refactoring suggestions for code improvement.

### 🎯 WHEN TO USE
- When you want to improve code quality
- Before making complex changes
- To explore different implementation approaches

### ⚠️ IMPORTANT
- Specify clear intent (e.g., "simplify nested conditions", "extract reusable logic")
- Review suggestions carefully before applying
- This uses AI (costs tokens)`,
        detailedDescription: `Get structured refactoring suggestions:
- Title and description of the refactoring
- Detailed changes with line numbers
- Benefits and potential risks
- Confidence level

Helps plan refactoring before making changes.`,
        category: 'lsp',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path to refactor', required: true },
            intent: { type: 'string', description: 'What you want to improve (e.g., "simplify nested if statements")', required: true },
        },
    },

    suggest_fixes: {
        name: 'suggest_fixes',
        displayName: 'AI Error Fixes',
        description: `Get AI-powered fix suggestions for code errors.

### 🎯 WHEN TO USE
- After get_lint_errors shows errors you don't know how to fix
- For complex type errors or compilation issues
- When you need multiple fix options

### ⚠️ IMPORTANT
- Run get_lint_errors first to get diagnostics
- This uses AI (costs tokens)
- Review fixes before applying`,
        detailedDescription: `Get structured fix suggestions for errors:
- Multiple solution options per error
- Detailed changes with line numbers
- Confidence level for each solution
- Explanation of what caused the error

Use after get_lint_errors to get AI help fixing issues.`,
        category: 'lsp',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path with errors', required: true },
        },
    },

    generate_tests: {
        name: 'generate_tests',
        displayName: 'AI Test Generation',
        description: `Generate test cases for code using AI.

### 🎯 WHEN TO USE
- After implementing new functions/classes
- When adding test coverage
- To get test structure examples

### ⚠️ IMPORTANT
- Specify test framework if known (e.g., "vitest", "jest")
- Review and adapt generated tests
- This uses AI (costs tokens)`,
        detailedDescription: `Generate structured test cases:
- Test framework setup
- Multiple test cases (unit, integration, e2e)
- Setup and teardown code
- Required imports

Helps bootstrap test files quickly.`,
        category: 'lsp',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path to generate tests for', required: true },
            framework: { type: 'string', description: 'Test framework (e.g., "vitest", "jest", "mocha")', required: false },
        },
    },

    // ===== 网络工具 =====
    web_search: {
        name: 'web_search',
        displayName: 'Web Search',
        description: 'Search the web for information. Use ONE comprehensive search query instead of multiple separate searches.',
        detailedDescription: `Search the web using Google or DuckDuckGo.

IMPORTANT GUIDELINES:
- Use ONE well-crafted search query that covers your information need
- DO NOT make multiple separate searches for related topics - combine them into one query
- Use specific keywords and phrases for better results
- For technical topics, include version numbers or specific terms
- After getting results, use read_url to get detailed content from relevant pages

GOOD: "React 18 useEffect cleanup function best practices"
BAD: Multiple searches like "React useEffect", "useEffect cleanup", "React best practices"

GOOD: "Python asyncio vs threading performance comparison 2024"
BAD: Separate searches for "Python asyncio" and "Python threading"`,
        category: 'network',
        approvalType: 'none',
        parallel: false,  // 禁止并行，避免多次分散搜索
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            query: {
                type: 'string',
                description: 'Search query - use ONE comprehensive query with specific keywords. Combine related topics into a single search.',
                required: true,
            },
            max_results: { type: 'number', description: 'Maximum results to return (default: 5, max: 10)', default: 5 },
        },
    },

    read_url: {
        name: 'read_url',
        displayName: 'Read URL',
        description: 'Fetch and read content from a URL. Use after web_search to get detailed information from specific pages.',
        detailedDescription: `Read the content of a web page using Jina Reader for optimized LLM-friendly output.

WHEN TO USE:
- After web_search returns relevant URLs that need detailed reading
- When you have a specific URL from the user or documentation
- To read API documentation, blog posts, or technical articles

TIPS:
- Jina Reader handles JavaScript-rendered pages (SPAs)
- For API endpoints or raw files, content is fetched directly
- Large pages are automatically truncated to 500KB`,
        category: 'network',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            url: { type: 'string', description: 'Full URL to fetch (must start with http:// or https://)', required: true },
            timeout: { type: 'number', description: 'Timeout in seconds (default: 60, minimum: 30). Use higher values for complex pages.', default: 60 },
        },
    },

    ask_user: {
        name: 'ask_user',
        displayName: 'Ask User',
        description: 'Ask user to select from options to gather requirements or preferences.',
        detailedDescription: `Present interactive options to the user and wait for their selection.
- Use to gather requirements, preferences, or confirmations
- Options are displayed as clickable cards
- Supports single or multiple selection
- The tool blocks until user makes a selection`,
        examples: [
            'ask_user question="What type of task?" options=[{id:"feature",label:"New Feature"},{id:"bugfix",label:"Bug Fix"}]',
            'ask_user question="Which files to modify?" options=[...] multiSelect=true',
        ],
        criticalRules: [
            'Use to gather requirements, preferences, or confirmations',
            'Keep options concise and clear',
            'Provide descriptions for complex options',
        ],
        category: 'interaction',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            question: { type: 'string', description: 'Question to ask the user', required: true },
            options: {
                type: 'array',
                description: 'Options for user to select from',
                required: true,
                items: {
                    type: 'object',
                    description: 'Option item. Use "id" or "value" as unique identifier.',
                    properties: {
                        // id 和 value 都可选，执行器会处理
                        id: { type: 'string', description: 'Unique option ID' },
                        value: { type: 'string', description: 'Alternative to id (will be used as id if id is not provided)' },
                        label: { type: 'string', description: 'Display label', required: true },
                        description: { type: 'string', description: 'Optional description' },
                    },
                },
            },
            multiSelect: { type: 'boolean', description: 'Allow multiple selections (default: false)', default: false },
        },
    },

    create_task_plan: {
        name: 'create_task_plan',
        displayName: 'Create Task Plan',
        description: 'Create a structured task plan with requirements document and task list.',
        detailedDescription: `Generate a task plan file that will be displayed in the TaskBoard.
- Creates a plan file in .adnify/plan/ directory
- Automatically opens the TaskBoard tab
- Each task includes suggested provider/model/role
- User can modify assignments before execution`,
        examples: [
            'create_task_plan name="Login Page" requirementsDoc="..." tasks=[{title:"Create form",suggestedProvider:"anthropic",suggestedModel:"claude-sonnet-4",suggestedRole:"coder"}]',
        ],
        criticalRules: [
            'Always gather requirements with ask_user before creating a plan',
            'Break complex requests into atomic tasks',
            'Suggest appropriate models based on task complexity',
            'Include clear task descriptions',
        ],
        category: 'orchestrator',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            name: { type: 'string', description: 'Human-readable name for the plan', required: true },
            requirementsDoc: { type: 'string', description: 'Markdown formatted requirements document', required: true },
            tasks: {
                type: 'array',
                description: 'List of tasks to execute',
                required: true,
                items: {
                    type: 'object',
                    description: 'Task definition',
                    properties: {
                        title: { type: 'string', description: 'Task title', required: true },
                        description: { type: 'string', description: 'Detailed task description', required: true },
                        suggestedProvider: { type: 'string', description: 'Recommended provider (openai, anthropic, gemini)', required: true },
                        suggestedModel: { type: 'string', description: 'Recommended model', required: true },
                        suggestedRole: { type: 'string', description: 'Recommended role/persona', required: true },
                        dependencies: { type: 'array', description: 'IDs of tasks this depends on', items: { type: 'string', description: 'Task ID' } },
                    },
                },
            },
            executionMode: { type: 'string', description: 'Default execution mode: sequential or parallel', enum: ['sequential', 'parallel'], default: 'sequential' },
        },
    },

    update_task_plan: {
        name: 'update_task_plan',
        displayName: 'Update Task Plan',
        description: 'Update an existing task plan based on user feedback. Can modify requirements, add/remove/update tasks.',
        detailedDescription: `Use this tool to modify an existing task plan when user requests changes.
You can:
- Update the requirements document
- Add new tasks
- Remove existing tasks
- Modify task details (title, description, model, role)
- Change execution mode`,
        examples: [
            'update_task_plan planId="login-1234" updateRequirements="增加密码强度验证" addTasks=[{title: "密码验证", ...}]',
            'update_task_plan planId="login-1234" removeTasks=["task-001"]',
        ],
        category: 'orchestrator',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            planId: { type: 'string', description: 'Plan ID to update', required: true },
            updateRequirements: { type: 'string', description: 'Additional requirements to append (markdown)' },
            addTasks: {
                type: 'array',
                description: 'New tasks to add',
                items: {
                    type: 'object',
                    description: 'Task definition',
                    properties: {
                        title: { type: 'string', description: 'Task title', required: true },
                        description: { type: 'string', description: 'Task description', required: true },
                        suggestedProvider: { type: 'string', description: 'Provider' },
                        suggestedModel: { type: 'string', description: 'Model' },
                        suggestedRole: { type: 'string', description: 'Role' },
                        insertAfter: { type: 'string', description: 'Insert after this task ID' },
                    },
                },
            },
            removeTasks: {
                type: 'array',
                description: 'Task IDs to remove',
                items: { type: 'string', description: 'Task ID to remove' },
            },
            updateTasks: {
                type: 'array',
                description: 'Tasks to update',
                items: {
                    type: 'object',
                    description: 'Task update',
                    properties: {
                        taskId: { type: 'string', description: 'Task ID', required: true },
                        title: { type: 'string', description: 'New title' },
                        description: { type: 'string', description: 'New description' },
                        provider: { type: 'string', description: 'New provider' },
                        model: { type: 'string', description: 'New model' },
                        role: { type: 'string', description: 'New role' },
                    },
                },
            },
            executionMode: { type: 'string', description: 'New execution mode', enum: ['sequential', 'parallel'] },
        },
    },

    start_task_execution: {
        name: 'start_task_execution',
        displayName: 'Start Task Execution',
        description: 'Start executing tasks in the active plan. Call this when user confirms they want to proceed.',
        detailedDescription: `Use this tool when user says things like:
- "开始执行"
- "执行" / "run"
- "开始" / "start"
- "Go ahead" / "Proceed"

This will trigger the task executor to run through the plan.`,
        examples: [
            'start_task_execution',
            'start_task_execution planId="login-1234"',
        ],
        category: 'orchestrator',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            planId: { type: 'string', description: 'Plan ID (optional, uses active plan if not specified)' },
        },
    },

    // ===== UI/UX 设计工具 =====
    uiux_search: {
        name: 'uiux_search',
        displayName: 'UI/UX Search',
        description: 'Search UI/UX design database for styles, colors, typography, icons, performance tips, and best practices.',
        detailedDescription: `Search the design knowledge base for:
- UI styles (glassmorphism, minimalism, etc.)
- Color palettes for different industries
- Typography and font pairings
- Chart recommendations
- Landing page patterns
- UX best practices
- Icon sets and recommendations
- React performance optimization
- UI reasoning and decision making
- Web interface components`,
        examples: [
            'uiux_search query="glassmorphism" domain="style"',
            'uiux_search query="saas dashboard" domain="color"',
            'uiux_search query="elegant font" domain="typography"',
            'uiux_search query="lucide heroicons" domain="icons"',
            'uiux_search query="memo optimization" domain="react-performance"',
        ],
        category: 'search',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            query: { type: 'string', description: 'Search keywords', required: true },
            domain: {
                type: 'string',
                description: 'Search domain (auto-detected if not specified)',
                enum: ['style', 'color', 'typography', 'chart', 'landing', 'product', 'ux', 'prompt', 'icons', 'react-performance', 'ui-reasoning', 'web-interface'],
            },
            stack: {
                type: 'string',
                description: 'Tech stack for stack-specific guidelines',
                enum: ['html-tailwind', 'react', 'nextjs', 'vue', 'svelte', 'swiftui', 'react-native', 'flutter', 'jetpack-compose', 'nuxt-ui', 'nuxtjs', 'shadcn'],
            },
            max_results: { type: 'number', description: 'Maximum results (default: 3)', default: 3 },
        },
    },

    uiux_recommend: {
        name: 'uiux_recommend',
        displayName: 'UI/UX Recommend',
        description: 'Get a complete design system recommendation for a product type, including style, colors, typography, and landing page pattern.',
        detailedDescription: `Input a product type and get a cohesive design recommendation:
- Recommended UI style with CSS/Tailwind keywords
- Color palette with hex values
- Typography pairing with Google Fonts
- Landing page pattern suggestion
- Key design considerations`,
        examples: [
            'uiux_recommend product_type="saas"',
            'uiux_recommend product_type="e-commerce luxury"',
            'uiux_recommend product_type="healthcare app"',
        ],
        category: 'search',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            product_type: { type: 'string', description: 'Product type (e.g., saas, e-commerce, fintech, healthcare)', required: true },
        },
    },

    remember: {
        name: 'remember',
        displayName: 'Remember',
        description: 'Propose a new project-level memory (fact or preference) to be remembered across conversations. This will show a confirmation card to the user.',
        detailedDescription: `Use this to persist important information about the project, such as:
- Technical stack or architectural decisions
- Recurring bugs and their fixes
- User preferences for code style or behavior
- Project-specific terminology`,
        category: 'interaction',
        approvalType: 'interaction',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            content: { type: 'string', description: 'The fact or preference to remember', required: true },
        },
    },
}



// ============================================
// 工具选择决策指南
// ============================================

/**
 * 文件编辑工具选择决策树
 * 根据场景选择最合适的工具
 */
export const FILE_EDIT_DECISION_GUIDE = `
## File Editing Tool Selection

**Decision Tree:**
1. Is this a NEW file that doesn't exist?
   → Use \`write_file\` or \`create_file_or_folder\`

2. Do you need to REPLACE THE ENTIRE file content?
   → Use \`write_file\`

3. Do you know the EXACT LINE NUMBERS to change?
   → Use \`replace_file_content\` (preferred for precision)

4. Do you know the EXACT TEXT to find and replace?
   → Use \`edit_file\` with old_string/new_string

**Quick Reference:**
| Scenario | Tool | Why |
|----------|------|-----|
| Create new file | write_file | Creates with full content |
| Rewrite entire file | write_file | Complete replacement |
| Change specific lines | replace_file_content | Line-based precision |
| Replace exact text | edit_file | String matching |
| Add to end of file | edit_file | Match last lines, add new |
`

/**
 * 搜索工具选择决策指南
 */
export const SEARCH_DECISION_GUIDE = `
## Search Tool Selection

**Decision Tree:**
1. Looking for a CONCEPT or MEANING (e.g., "authentication logic")?
   → Use \`codebase_search\` (semantic/AI search)

2. Looking for EXACT TEXT or PATTERN?
   → Use \`search_files\` (text/regex search)
   → For multiple patterns, combine with | (e.g., "pattern1|pattern2|pattern3")

3. Searching within a SINGLE FILE?
   → Use \`search_files\` with file path as path parameter
   → Example: search_files path="src/styles.css" pattern="button|card"

4. Looking for FILES BY NAME/PATTERN?
   → Use \`list_directory\` or \`get_dir_tree\`

**NEVER use bash grep/find - use these tools instead.**

**ANTI-FRAGMENTATION:**
- Combine multiple patterns with | instead of making multiple calls
- Use read_multiple_files instead of multiple read_file calls
`

// ============================================
// 生成器函数
// ============================================

import type { ToolDefinition, ToolPropertySchema } from '@/shared/types/llm'

/** 将 ToolPropertyDef 转换为 ToolPropertySchema */
function convertToPropertySchema(prop: ToolPropertyDef): ToolPropertySchema {
    const schema: ToolPropertySchema = {
        type: prop.type,
        description: prop.description,
    }
    if (prop.enum) schema.enum = prop.enum
    if (prop.items) schema.items = convertToPropertySchema(prop.items)
    if (prop.properties) {
        schema.properties = Object.fromEntries(
            Object.entries(prop.properties).map(([k, v]) => [k, convertToPropertySchema(v)])
        )
    }
    return schema
}

/** 生成 LLM 工具定义 */
export function generateToolDefinition(config: ToolConfig): ToolDefinition {
    const properties: Record<string, ToolPropertySchema> = {}
    const required: string[] = []

    for (const [key, prop] of Object.entries(config.parameters)) {
        properties[key] = convertToPropertySchema(prop)
        if (prop.required) {
            required.push(key)
        }
    }

    return {
        name: config.name,
        description: config.description,
        ...(config.approvalType !== 'none' && { approvalType: config.approvalType }),
        parameters: {
            type: 'object',
            properties,
            required,  // Anthropic 要求 required 必须是数组，即使为空
        },
    }
}

// ============================================
// Zod 预处理辅助函数 (增强容错性)
// ============================================

const preprocessNumber = (val: unknown) => {
    if (typeof val === 'string' && val.trim() !== '') {
        const parsed = Number(val)
        return isNaN(parsed) ? val : parsed
    }
    return val
}

const preprocessBoolean = (val: unknown) => {
    if (typeof val === 'string') {
        const lower = val.toLowerCase()
        if (lower === 'true') return true
        if (lower === 'false') return false
    }
    return val
}

const preprocessArray = (val: unknown) => {
    if (typeof val === 'string') {
        try {
            return JSON.parse(val)
        } catch {
            return val
        }
    }
    return val
}

/** 递归生成 Zod Schema (支持嵌套和自动类型转换) */
function createZodType(prop: ToolPropertyDef): z.ZodTypeAny {
    switch (prop.type) {
        case 'string':
            if (prop.enum) {
                return z.enum(prop.enum as [string, ...string[]])
            }
            return z.string()
        case 'number':
            return z.preprocess(preprocessNumber, z.number().int())
        case 'boolean':
            return z.preprocess(preprocessBoolean, z.boolean())
        case 'array':
            let itemSchema: z.ZodTypeAny = z.any()
            if (prop.items) {
                itemSchema = createZodType(prop.items)
            }
            return z.preprocess(preprocessArray, z.array(itemSchema))
        case 'object':
            if (prop.properties) {
                const shape: Record<string, z.ZodTypeAny> = {}
                for (const [k, v] of Object.entries(prop.properties)) {
                    let s = createZodType(v)
                    if (!v.required) s = s.optional()
                    shape[k] = s
                }
                return z.object(shape).passthrough()
            }
            return z.object({}).passthrough()
        default:
            return z.any()
    }
}

/** 生成 Zod Schema */
export function generateZodSchema(config: ToolConfig): z.ZodSchema {
    if (config.customSchema) {
        return config.customSchema
    }

    const shape: Record<string, z.ZodTypeAny> = {}

    for (const [key, prop] of Object.entries(config.parameters)) {
        let schema = createZodType(prop)

        // 重新应用顶层的 required 验证消息
        if (prop.type === 'string' && prop.required && !prop.enum) {
            schema = z.string().min(1, `${key} is required`)
        }

        if (!prop.required) {
            schema = schema.optional()
            if (prop.default !== undefined) {
                schema = schema.default(prop.default)
            }
        }

        shape[key] = schema
    }

    // 使用 passthrough() 允许额外的字段（如 _meta）
    const objectSchema = z.object(shape).passthrough()

    // 添加自定义验证
    if (config.validate) {
        return objectSchema.refine(
            (data) => config.validate!(data).valid,
            (data) => ({ message: config.validate!(data).error || 'Validation failed' })
        )
    }

    return objectSchema
}

// ============================================
// 生成系统提示词中的工具描述
// ============================================

/**
 * 生成单个工具的详细提示词描述
 * 
 * 使用 description 作为主要描述（包含反碎片化规则）
 */
export function generateToolPromptDescription(config: ToolConfig): string {
    const lines: string[] = []

    // 工具名
    lines.push(`### ${config.displayName} (\`${config.name}\`)`)

    // 使用 description（包含反碎片化规则）作为主要描述
    lines.push(config.description)
    lines.push('')

    // 参数
    const params = Object.entries(config.parameters)
    if (params.length > 0) {
        lines.push('**Parameters:**')
        for (const [key, prop] of params) {
            const required = prop.required ? '(required)' : '(optional)'
            const defaultVal = prop.default !== undefined ? ` [default: ${prop.default}]` : ''
            lines.push(`- \`${key}\` ${required}: ${prop.description}${defaultVal}`)
        }
        lines.push('')
    }

    // 常见错误（保留，因为对用户有帮助）
    if (config.commonErrors && config.commonErrors.length > 0) {
        lines.push('**Common Errors:**')
        for (const err of config.commonErrors) {
            lines.push(`- "${err.error}" → ${err.solution}`)
        }
        lines.push('')
    }

    return lines.join('\n')
}

/**
 * 生成工具提示词描述（可排除指定类别和指定工具）
 * 
 * @param excludeCategories 要排除的工具类别
 * @param allowedTools 允许的工具列表（如果提供，只包含这些工具）
 */
export function generateToolsPromptDescriptionFiltered(
    excludeCategories: ToolCategory[] = [],
    allowedTools?: string[]
): string {
    const categories: Record<ToolCategory, ToolConfig[]> = {
        read: [],
        search: [],
        write: [],
        terminal: [],
        lsp: [],
        network: [],
        interaction: [],
        orchestrator: [],
    }

    // 按类别分组
    for (const config of Object.values(TOOL_CONFIGS)) {
        // 检查是否启用、类别是否被排除、是否在允许列表中
        const isEnabled = config.enabled
        const categoryAllowed = !excludeCategories.includes(config.category)
        const toolAllowed = !allowedTools || allowedTools.includes(config.name)

        if (isEnabled && categoryAllowed && toolAllowed) {
            categories[config.category].push(config)
        }
    }

    const sections: string[] = []

    if (categories.read.length > 0) {
        sections.push('## File Reading Tools')
        for (const config of categories.read) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    if (categories.search.length > 0) {
        sections.push('## Search Tools')
        sections.push(SEARCH_DECISION_GUIDE)
        for (const config of categories.search) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    if (categories.write.length > 0) {
        sections.push('## File Editing Tools')
        sections.push(FILE_EDIT_DECISION_GUIDE)
        for (const config of categories.write) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    if (categories.terminal.length > 0) {
        sections.push('## Terminal Tools')
        for (const config of categories.terminal) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    if (categories.lsp.length > 0) {
        sections.push('## Code Intelligence Tools')
        for (const config of categories.lsp) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    if (categories.network.length > 0) {
        sections.push('## Network Tools')
        for (const config of categories.network) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    if (categories.interaction.length > 0) {
        sections.push('## Interaction Tools')
        for (const config of categories.interaction) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    return sections.join('\n\n')
}

// ============================================
// 导出生成的数据
// ============================================

/** 所有工具定义（发送给 LLM） */
export const TOOL_DEFINITIONS = Object.fromEntries(
    Object.entries(TOOL_CONFIGS).map(([name, config]) => [name, generateToolDefinition(config)])
)

/** 所有 Zod Schemas */
export const TOOL_SCHEMAS = Object.fromEntries(
    Object.entries(TOOL_CONFIGS).map(([name, config]) => [name, generateZodSchema(config)])
)

/** 工具显示名称映射 */
export const TOOL_DISPLAY_NAMES = Object.fromEntries(
    Object.entries(TOOL_CONFIGS).map(([name, config]) => [name, config.displayName])
)

// ============================================
// 辅助函数
// ============================================

/** 获取工具审批类型 */
export function getToolApprovalType(toolName: string): ToolApprovalType {
    return TOOL_CONFIGS[toolName]?.approvalType || 'none'
}

/** 获取工具显示名称 */
export function getToolDisplayName(toolName: string): string {
    return TOOL_CONFIGS[toolName]?.displayName || toolName
}

/** 获取只读工具列表 */
export function getReadOnlyTools(): string[] {
    return Object.entries(TOOL_CONFIGS)
        .filter(([_, config]) => config.parallel && config.category !== 'write')
        .map(([name]) => name)
}

/** 获取写入工具列表 */
export function getWriteTools(): string[] {
    return Object.entries(TOOL_CONFIGS)
        .filter(([_, config]) => config.category === 'write')
        .map(([name]) => name)
}

/** 获取需要审批的工具 */
export function getApprovalRequiredTools(): string[] {
    return Object.entries(TOOL_CONFIGS)
        .filter(([_, config]) => config.approvalType !== 'none')
        .map(([name]) => name)
}

/** 检查工具是否可并行执行 */
export function isParallelTool(toolName: string): boolean {
    return TOOL_CONFIGS[toolName]?.parallel ?? false
}

/** 获取可并行执行的工具列表 */
export function getParallelTools(): string[] {
    return Object.entries(TOOL_CONFIGS)
        .filter(([_, config]) => config.parallel)
        .map(([name]) => name)
}

/** 检查工具是否为写入类工具 */
export function isWriteTool(toolName: string): boolean {
    return TOOL_CONFIGS[toolName]?.category === 'write'
}

/** 检查工具是否为文件编辑工具（会产生文件内容变更，不包括删除） */
export function isFileEditTool(toolName: string): boolean {
    return ['edit_file', 'write_file', 'create_file_or_folder', 'replace_file_content'].includes(toolName)
}

/** 检查工具是否需要保存文件快照（用于撤销功能） */
export function needsFileSnapshot(toolName: string): boolean {
    return ['edit_file', 'write_file', 'create_file_or_folder', 'replace_file_content', 'delete_file_or_folder'].includes(toolName)
}

/** 检查工具是否需要 Diff 预览（使用 FileChangeCard） */
export function needsDiffPreview(toolName: string): boolean {
    return ['edit_file', 'write_file', 'replace_file_content'].includes(toolName)
}

/** 获取工具元数据 */
export function getToolMetadata(toolName: string): ToolConfig | undefined {
    return TOOL_CONFIGS[toolName]
}
