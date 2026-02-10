import { logger } from '@shared/utils/Logger'
import * as path from 'path'
import * as crypto from 'crypto'
import Parser from 'web-tree-sitter'
import * as fs from 'fs'
import { CodeChunk, IndexConfig, DEFAULT_INDEX_CONFIG } from './types'

// Map file extensions to Tree-sitter language names
const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', pyw: 'python',
  go: 'go', rs: 'rust', java: 'java',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
  cs: 'c_sharp', rb: 'ruby', php: 'php',
  json: 'json'
}

// Tree-sitter queries for capturing definitions
// We focus on capturing the entire function/class body
const QUERIES: Record<string, string> = {
  typescript: `
    (function_declaration) @function
    (generator_function_declaration) @function
    (class_declaration) @class
    (interface_declaration) @interface
    (type_alias_declaration) @type
    (method_definition) @method
    (export_statement (function_declaration)) @function
    (export_statement (class_declaration)) @class
    (variable_declarator 
      name: (identifier) @name
      value: [(arrow_function) (function_expression)] @function_body
    ) @arrow_function
    ;; Capture top-level statements that are not imports/exports (simplified)
    (program (expression_statement) @statement)
    (program (lexical_declaration) @statement)
  `,
  tsx: `
    (function_declaration) @function
    (class_declaration) @class
    (interface_declaration) @interface
    (type_alias_declaration) @type
    (method_definition) @method
    (variable_declarator 
      name: (identifier) @name
      value: [(arrow_function) (function_expression)] @function_body
    ) @arrow_function
  `,
  javascript: `
    (function_declaration) @function
    (generator_function_declaration) @function
    (class_declaration) @class
    (method_definition) @method
    (variable_declarator 
      name: (identifier) @name
      value: [(arrow_function) (function_expression)] @function_body
    ) @arrow_function
  `,
  python: `
    (function_definition) @function
    (class_definition) @class
    ;; Top level code
    (module (expression_statement) @statement)
  `,
  go: `
    (function_declaration) @function
    (method_declaration) @method
    (type_declaration) @type
  `,
  rust: `
    (function_item) @function
    (struct_item) @struct
    (enum_item) @enum
    (impl_item) @impl
    (trait_item) @trait
  `,
  java: `
    (class_declaration) @class
    (interface_declaration) @interface
    (enum_declaration) @enum
    (method_declaration) @method
    (constructor_declaration) @constructor
  `,
  cpp: `
    (function_definition) @function
    (class_specifier) @class
    (struct_specifier) @struct
  `,
  c: `
    (function_definition) @function
    (struct_specifier) @struct
  `,
  c_sharp: `
    (class_declaration) @class
    (interface_declaration) @interface
    (enum_declaration) @enum
    (struct_declaration) @struct
    (method_declaration) @method
    (constructor_declaration) @constructor
  `,
  ruby: `
    (method) @function
    (class) @class
    (module) @module
  `,
  php: `
    (function_definition) @function
    (class_declaration) @class
    (interface_declaration) @interface
    (trait_declaration) @trait
    (method_declaration) @method
  `
}

export class TreeSitterChunker {
  private config: IndexConfig
  private parser: Parser | null = null
  private languages: Map<string, Parser.Language> = new Map()
  private failedLanguages: Set<string> = new Set() // 记录加载失败的语言，避免重复警告
  private initialized = false
  private wasmDir: string

  constructor(config?: Partial<IndexConfig>) {
    this.config = { ...DEFAULT_INDEX_CONFIG, ...config }

    // Determine WASM directory (needs to work in Dev and Prod)
    // We try multiple potential locations to be robust
    const potentialPaths = [
      path.join(process.resourcesPath || '', 'tree-sitter'), // Packaged app resources
      path.join(process.cwd(), 'resources', 'tree-sitter'),  // Dev mode project root
      path.join(__dirname, '..', '..', '..', 'resources', 'tree-sitter'), // Relative from build/
    ];

    // We will resolve the actual path in init() or check existence here if synchronous check is allowed.
    // simpler: store potential paths and try them in order during init/load
    this.wasmDir = potentialPaths.find(p => fs.existsSync(p)) || potentialPaths[1];

  }

  async init() {
    if (this.initialized) return

    try {
      const parserWasm = path.join(this.wasmDir, 'tree-sitter.wasm')
      // Note: Parser.init() takes an object with locateFile in newer versions or just init()
      // But web-tree-sitter implementation details vary. 
      // Usually Parser.init() loads the wasm.
      await Parser.init({
        locateFile: () => parserWasm
      })
      this.parser = new Parser()
      this.initialized = true
    } catch (e) {
      logger.index.error('[TreeSitterChunker] Failed to initialize parser:', e)
      // Fallback or rethrow? 
      // If TS fails, we might want to fallback to regex chunker.
    }
  }

  private async loadLanguage(langName: string): Promise<boolean> {
    if (!this.parser) return false
    if (this.languages.has(langName)) {
      this.parser.setLanguage(this.languages.get(langName) ?? null)
      return true
    }

    // 如果之前已经加载失败，静默跳过
    if (this.failedLanguages.has(langName)) {
      return false
    }

    try {
      const wasmPath = path.join(this.wasmDir, `tree-sitter-${langName}.wasm`)
      const lang = await Parser.Language.load(wasmPath)
      this.languages.set(langName, lang)
      this.parser.setLanguage(lang)
      return true
    } catch (e) {
      // 只在第一次失败时警告，后续静默处理
      this.failedLanguages.add(langName)
      logger.index.warn(`[TreeSitterChunker] Failed to load language ${langName}:`, e)
      return false
    }
  }

  async chunkFile(filePath: string, content: string, workspacePath: string): Promise<CodeChunk[]> {
    if (!this.initialized) await this.init()
    if (!this.parser) return [] // Should fallback to regex

    const fileHash = crypto.createHash('sha256').update(content).digest('hex')
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const langName = LANGUAGE_MAP[ext]

    if (!langName) return [] // Fallback

    const loaded = await this.loadLanguage(langName)
    if (!loaded) return [] // Fallback

    const tree = this.parser.parse(content)
    if (!tree) return [] // Parse failed

    const queryStr = QUERIES[langName]

    if (!queryStr) {
      // No query for this language, maybe just return whole file or fallback?
      tree.delete()
      return []
    }

    const chunks: CodeChunk[] = []
    const relativePath = path.relative(workspacePath, filePath)

    // Store ranges covered by TS captures to fill gaps later
    const coveredRanges: Array<{ start: number, end: number }> = []

    try {
      const lang = this.languages.get(langName)!
      const query = lang.query(queryStr)
      const captures = query.captures(tree.rootNode)

      // Sort captures by start index to process in order
      captures.sort((a: Parser.QueryCapture, b: Parser.QueryCapture) => a.node.startIndex - b.node.startIndex)

      for (const capture of captures) {
        const { node, name } = capture

        // Skip small nodes
        if (node.endPosition.row - node.startPosition.row < 3) continue

        // Deduplicate: check if this node is already covered by a parent capture
        // (Since we sort by start index, parents usually come first or we need to check overlap)
        // Simplification: if this node is fully inside previous range, skip?
        // Actually for nested structures (class with methods), we might want BOTH 
        // OR we just want the smallest units? 
        // Standard RAG split: Usually smallest overlapping units are better for retrieval context.
        // But here we keep it simple: capture everything defined in QUERIES.

        // Update covered ranges
        coveredRanges.push({ start: node.startPosition.row, end: node.endPosition.row })

        // 检查节点大小，如果过大则递归拆分
        const maxChunkChars = this.config.chunkSize * 50 // ~25000 chars roughly
        if (node.text.length > maxChunkChars) {
          // 递归拆分大块
          const subChunks = this.splitLargeNode(node, filePath, relativePath, fileHash, langName, maxChunkChars)
          if (subChunks.length > 0) {
            chunks.push(...subChunks)
            continue
          }
          // Fallback to truncation
          chunks.push({
            id: `${filePath}:${node.startPosition.row}`,
            filePath,
            relativePath,
            fileHash,
            content: node.text.slice(0, maxChunkChars) + '\n...[truncated]',
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            type: this.mapCaptureToType(name),
            language: langName,
            symbols: this.extractName(node)
          })
          continue
        }

        chunks.push({
          id: `${filePath}:${node.startPosition.row}`,
          filePath,
          relativePath,
          fileHash,
          content: node.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          type: this.mapCaptureToType(name),
          language: langName,
          symbols: this.extractName(node)
        })
      }

      // Fill gaps (code not captured by Tree-sitter)
      const gapChunks = this.chunkGaps(content, coveredRanges, filePath, relativePath, fileHash, langName)
      if (gapChunks.length > 0) {
        chunks.push(...gapChunks)
      }

    } catch (e) {
      logger.index.error(`[TreeSitterChunker] Error querying ${filePath}:`, e)
    } finally {
      tree.delete()
    }

    return chunks
  }

  /**
   * Handle code gaps not covered by Tree-sitter captures
   * e.g. top level scripts, large comments, imports (if useful)
   */
  private chunkGaps(
    content: string,
    coveredRanges: Array<{ start: number, end: number }>,
    filePath: string,
    relativePath: string,
    fileHash: string,
    langName: string
  ): CodeChunk[] {
    const lines = content.split('\n')
    const chunks: CodeChunk[] = []

    // Merge overlapping ranges and sort
    if (coveredRanges.length === 0) {
      // No captures, chunk entire file if it's code? 
      // Maybe it's a script file not matching any query.
      // For now, let's just return nothing or implement a simple line chunker here.
      // Better to keep behavior consistent: if TS fails to find structure, fallback to regex chunker (handled in caller).
      return []
    }

    coveredRanges.sort((a, b) => a.start - b.start)
    const merged: Array<{ start: number, end: number }> = []
    if (coveredRanges.length > 0) {
      let current = coveredRanges[0]
      for (let i = 1; i < coveredRanges.length; i++) {
        if (coveredRanges[i].start <= current.end) {
          current.end = Math.max(current.end, coveredRanges[i].end)
        } else {
          merged.push(current)
          current = coveredRanges[i]
        }
      }
      merged.push(current)
    }

    // Find gaps
    let currentLine = 0
    for (const range of merged) {
      if (range.start > currentLine) {
        // Gap found
        const gapLines = lines.slice(currentLine, range.start)
        // Only chunk if gap is significant
        if (gapLines.length > 5 && gapLines.join('').trim().length > 50) {
          chunks.push({
            id: `${filePath}:gap:${currentLine}`,
            filePath,
            relativePath,
            fileHash,
            content: gapLines.join('\n'),
            startLine: currentLine + 1,
            endLine: range.start, // exclusive in slice, so line number is inclusive? 
            // slice(0, 5) -> 0,1,2,3,4. 
            // range.start is the line index where next block starts.
            // so previous block ends at range.start - 1. 
            // But line numbers are 1-based.
            type: 'block',
            language: langName,
            symbols: []
          })
        }
      }
      currentLine = range.end + 1 // range.end is inclusive index of last line?
      // In TS node, endPosition.row is the index of the row where node ends. 
      // If node ends at line 10, range.end is 10.
      // So next content starts at 11?
      // Correct, endPosition is inclusive for row? 
      // Actually tree-sitter node.endPosition is where it ends.
      // If a node covers line 5 to 10. currentLine should become 11.
    }

    // Check tail
    if (currentLine < lines.length) {
      const gapLines = lines.slice(currentLine)
      if (gapLines.length > 5 && gapLines.join('').trim().length > 50) {
        chunks.push({
          id: `${filePath}:gap:${currentLine}`,
          filePath,
          relativePath,
          fileHash,
          content: gapLines.join('\n'),
          startLine: currentLine + 1,
          endLine: lines.length,
          type: 'block',
          language: langName,
          symbols: []
        })
      }
    }

    return chunks
  }


  /**
   * 迭代拆分过大的代码块（避免栈溢出）
   * 使用栈模拟递归，处理深层嵌套的大型代码块
   */
  private splitLargeNode(
    node: Parser.SyntaxNode,
    filePath: string,
    relativePath: string,
    fileHash: string,
    langName: string,
    maxChunkChars: number
  ): CodeChunk[] {
    const chunks: CodeChunk[] = []
    const stack: Parser.SyntaxNode[] = [node]

    while (stack.length > 0) {
      const current = stack.pop()!

      // 获取有意义的子节点
      const meaningfulChildren: Parser.SyntaxNode[] = []
      for (let i = 0; i < current.childCount; i++) {
        const child = current.child(i)
        if (child && child.text.length > 50) {
          meaningfulChildren.push(child)
        }
      }

      // 无法拆分：没有足够的子节点
      if (meaningfulChildren.length < 2) {
        // 截断当前节点
        if (current.text.length > maxChunkChars) {
          chunks.push({
            id: `${filePath}:${current.startPosition.row}`,
            filePath,
            relativePath,
            fileHash,
            content: current.text.slice(0, maxChunkChars) + '\n...[truncated]',
            startLine: current.startPosition.row + 1,
            endLine: current.endPosition.row + 1,
            type: 'block',
            language: langName,
            symbols: this.extractName(current)
          })
        }
        continue
      }

      // 处理子节点
      for (const child of meaningfulChildren) {
        if (child.text.length > maxChunkChars) {
          // 子节点过大，加入栈继续拆分
          stack.push(child)
        } else if (child.endPosition.row - child.startPosition.row >= 3) {
          // 子节点大小合适，直接添加
          chunks.push({
            id: `${filePath}:${child.startPosition.row}`,
            filePath,
            relativePath,
            fileHash,
            content: child.text,
            startLine: child.startPosition.row + 1,
            endLine: child.endPosition.row + 1,
            type: 'block',
            language: langName,
            symbols: this.extractName(child)
          })
        }
      }
    }

    return chunks
  }

  /**
   * Map Tree-sitter capture names to CodeChunk types
   */
  private mapCaptureToType(captureName: string): 'file' | 'function' | 'class' | 'block' {
    // Capture names like @function, @class, @method, etc.
    if (captureName === 'function' || captureName === 'method' || captureName === 'arrow_function' || captureName === 'constructor') {
      return 'function'
    }
    if (captureName === 'class' || captureName === 'interface' || captureName === 'struct' || captureName === 'enum' || captureName === 'trait' || captureName === 'impl' || captureName === 'module') {
      return 'class'
    }
    if (captureName === 'type') {
      return 'block'
    }
    if (captureName === 'statement') {
      return 'block'
    }
    return 'block'
  }

  private extractName(node: Parser.SyntaxNode): string[] {
    // Try to find an identifier child
    // This is heuristics. 
    // For 'arrow_function' pattern, we captured @name separately but here we iterate captures.
    // Ideally we process matches not captures to get @name and @body pairs.
    // But captures list flattens it.

    // A simple heuristic: look for first child that is an 'identifier' or 'name'
    const findId = (n: Parser.SyntaxNode): string | null => {
      if (n.type === 'identifier' || n.type === 'type_identifier' || n.type === 'name') return n.text
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && (child.type === 'identifier' || child.type === 'name')) return child.text
        // specific for function_declaration
        if (child && child.type === 'function_declarator') return findId(child)
      }
      return null
    }

    const name = findId(node)
    return name ? [name] : []
  }
}
