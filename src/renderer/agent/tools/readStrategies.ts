/**
 * 文件职责：
 * 1. 统一描述 read_file 在不同文件类型下的读取策略。
 * 2. 把“是否加行号、是否附带 AST 摘要、最大返回长度”等规则抽离出执行器。
 * 3. 为后续继续扩展文档类、代码类、结构化文本类读取策略提供单一入口。
 *
 * 设计目标：
 * - 代码文件偏向“可定位、可编辑”，所以通常保留行号。
 * - 文档文件偏向“可阅读、可汇总”，所以通常返回纯文本而不是带行号的噪音输出。
 * - 结构化文本介于两者之间，既要可读，也要保留一定定位能力。
 */
export type ReadContentKind = 'code' | 'document' | 'structured' | 'unknown'

/**
 * 读取策略的输入。
 * 这里只依赖路径、基础预算和是否显式指定行范围，不耦合具体工具执行细节。
 */
export interface ReadStrategyInput {
  path: string
  baseMaxChars: number
  hasExplicitLineRange: boolean
}

/**
 * 读取策略的输出。
 * 执行层只需要消费这个结果，不需要再自己判断一堆 if/else。
 */
export interface ReadStrategy {
  kind: ReadContentKind
  includeLineNumbers: boolean
  includeAstSummary: boolean
  maxChars: number
}

// 文档类扩展名：这类内容通常更适合全文阅读、总结、合并，而不是行号驱动的精确编辑。
const DOCUMENT_EXTENSIONS = new Set([
  'md', 'markdown', 'mdx', 'txt', 'rst', 'adoc', 'asciidoc',
  'log', 'text',
])

// 结构化文本：仍然是文本，但往往需要一定定位能力，因此默认保留行号更稳妥。
const STRUCTURED_TEXT_EXTENSIONS = new Set([
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'conf',
  'xml', 'csv', 'tsv', 'env',
])

// 代码类扩展名：默认保留行号，并允许后续附带 AST/调用摘要。
const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'java', 'go', 'rs', 'c', 'cc', 'cpp', 'cxx', 'h', 'hpp',
  'cs', 'php', 'rb', 'swift', 'kt', 'kts', 'scala',
  'sh', 'bash', 'zsh', 'ps1', 'sql',
  'css', 'scss', 'sass', 'less', 'html', 'vue', 'svelte',
])

/**
 * 取文件名并统一转小写，避免路径分隔符和大小写差异影响分类结果。
 */
function getLowerBasename(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return (parts[parts.length - 1] || '').toLowerCase()
}

/**
 * 提取扩展名。
 * 这里只做轻量分类，不引入 path 模块，避免在渲染侧增加额外依赖。
 */
function getExtension(path: string): string {
  const basename = getLowerBasename(path)
  const match = basename.match(/\.([^.]+)$/)
  return match?.[1] || ''
}

/**
 * 根据文件名和扩展名推断读取内容类型。
 * 这是整个读取策略分发的第一步。
 */
export function classifyReadContent(path: string): ReadContentKind {
  const basename = getLowerBasename(path)
  const ext = getExtension(path)

  if (basename === 'readme' || basename.startsWith('readme.')) return 'document'
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document'
  if (STRUCTURED_TEXT_EXTENSIONS.has(ext)) return 'structured'
  if (CODE_EXTENSIONS.has(ext)) return 'code'
  return 'unknown'
}

/**
 * 统一生成 read_file 的读取策略。
 *
 * 特别说明：
 * - 一旦用户明确指定 start_line/end_line，说明当前目标是“精确定位”，因此强制回到带行号模式。
 * - 文档类文件会获得更高的字符预算，减少 Markdown/计划文档在合并场景下被过早截断。
 */
export function getReadStrategy(input: ReadStrategyInput): ReadStrategy {
  const kind = classifyReadContent(input.path)

  if (input.hasExplicitLineRange) {
    return {
      kind,
      includeLineNumbers: true,
      includeAstSummary: kind === 'code',
      maxChars: Math.max(input.baseMaxChars, 16000),
    }
  }

  switch (kind) {
    case 'document':
      return {
        kind,
        includeLineNumbers: false,
        includeAstSummary: false,
        maxChars: Math.max(input.baseMaxChars, 32000),
      }
    case 'structured':
      return {
        kind,
        includeLineNumbers: true,
        includeAstSummary: false,
        maxChars: Math.max(input.baseMaxChars, 18000),
      }
    case 'code':
      return {
        kind,
        includeLineNumbers: true,
        includeAstSummary: true,
        maxChars: input.baseMaxChars,
      }
    default:
      return {
        kind,
        includeLineNumbers: false,
        includeAstSummary: false,
        maxChars: Math.max(input.baseMaxChars, 20000),
      }
  }
}

/**
 * 统一构造读取截断提示。
 * 不同内容类型的提示也不同：
 * - 文档类更强调“继续分批读取/改用区间读取”；
 * - 行号模式更强调“用 start_line/end_line 精确继续读取”。
 */
export function buildReadTruncationMessage(strategy: ReadStrategy, visibleLines: number, totalLines: number): string {
  if (!strategy.includeLineNumbers) {
    return `\n\n⚠️ FILE TRUNCATED (~${strategy.maxChars} chars shown). For full long documents, split reads into smaller batches or use line ranges if you need a specific section.`
  }

  return (
    `\n\n⚠️ FILE TRUNCATED (showing ${visibleLines} of ${totalLines} lines, ~${strategy.maxChars} chars)\n` +
    'To read more: use search_files to find the target location, then call read_file with start_line/end_line'
  )
}
