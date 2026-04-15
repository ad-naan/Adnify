/**
 * 编辑重试策略
 * 
 * 当 edit_file 失败时，提供智能的错误恢复建议和自动重试机制
 * 参考 Claude Code 的错误恢复策略
 */

import { api } from '@/renderer/services/electronAPI'
import { smartReplace, normalizeLineEndings } from '@/renderer/utils/smartReplace'
import type { ReplaceErrorCode } from '@/renderer/utils/smartReplace'

// ============================================
// 类型定义
// ============================================

export interface EditAttempt {
  path: string
  oldString: string
  newString: string
  replaceAll?: boolean
}

export interface EditResult {
  success: boolean
  newContent?: string
  error?: string
  strategy?: string
  suggestion?: string
  /** 是否建议重新读取文件 */
  shouldReread?: boolean
  /** 找到的相似内容（用于提示） */
  similarContent?: string
}

export interface RetryContext {
  /** 文件的当前内容 */
  currentContent: string
  /** 之前的尝试记录 */
  previousAttempts: EditAttempt[]
  /** 最大重试次数 */
  maxRetries: number
}

// ============================================
// 错误分析
// ============================================

export type EditErrorType = 
  | 'not_found'           // old_string 未找到
  | 'multiple_matches'    // 找到多个匹配
  | 'file_not_found'      // 文件不存在
  | 'file_changed'        // 文件已被修改
  | 'permission_denied'   // 权限问题
  | 'unknown'             // 未知错误

/**
 * 分析编辑错误类型
 */
export function analyzeEditError(error?: string, errorCode?: ReplaceErrorCode): EditErrorType {
  switch (errorCode) {
    case 'OLD_STRING_NOT_FOUND':
    case 'MISSING_OLD_STRING':
      return 'not_found'
    case 'MULTIPLE_MATCHES':
      return 'multiple_matches'
    case 'IDENTICAL_STRINGS':
      return 'unknown'
  }

  const lowerError = (error || '').toLowerCase()
  
  if (lowerError.includes('not found') || lowerError.includes('未找到')) {
    return 'not_found'
  }
  if (lowerError.includes('multiple') || lowerError.includes('多个')) {
    return 'multiple_matches'
  }
  if (lowerError.includes('file not found') || lowerError.includes('文件不存在')) {
    return 'file_not_found'
  }
  if (lowerError.includes('permission') || lowerError.includes('权限')) {
    return 'permission_denied'
  }
  if (lowerError.includes('changed') || lowerError.includes('modified') || lowerError.includes('已修改')) {
    return 'file_changed'
  }
  
  return 'unknown'
}

// ============================================
// 相似内容查找
// ============================================

/**
 * 在文件中查找与 oldString 相似的内容
 */
export function findSimilarContent(
  content: string,
  oldString: string,
  threshold: number = 0.6
): { found: boolean; similarText?: string; similarity?: number; lineNumber?: number } {
  const normalizedOld = normalizeLineEndings(oldString).trim()
  const normalizedContent = normalizeLineEndings(content)
  const contentLines = normalizedContent.split('\n')
  const oldLines = normalizedOld.split('\n')

  // 如果是单行，逐行查找相似
  if (oldLines.length === 1) {
    const searchLine = oldLines[0].trim()
    let bestMatch = { similarity: 0, line: '', lineNumber: 0 }

    for (let i = 0; i < contentLines.length; i++) {
      const line = contentLines[i].trim()
      if (line.length === 0) continue

      const similarity = calculateLineSimilarity(searchLine, line)
      if (similarity > bestMatch.similarity) {
        bestMatch = { similarity, line: contentLines[i], lineNumber: i + 1 }
      }
    }

    if (bestMatch.similarity >= threshold) {
      return {
        found: true,
        similarText: bestMatch.line,
        similarity: bestMatch.similarity,
        lineNumber: bestMatch.lineNumber,
      }
    }
  }

  // 多行：使用滑动窗口查找相似块
  const windowSize = oldLines.length
  let bestMatch = { similarity: 0, text: '', lineNumber: 0 }

  for (let i = 0; i <= contentLines.length - windowSize; i++) {
    const block = contentLines.slice(i, i + windowSize).join('\n')
    const similarity = calculateBlockSimilarity(normalizedOld, block)

    if (similarity > bestMatch.similarity) {
      bestMatch = { similarity, text: block, lineNumber: i + 1 }
    }
  }

  if (bestMatch.similarity >= threshold) {
    return {
      found: true,
      similarText: bestMatch.text,
      similarity: bestMatch.similarity,
      lineNumber: bestMatch.lineNumber,
    }
  }

  return { found: false }
}

/**
 * 计算两行的相似度（基于 Levenshtein 距离）
 */
function calculateLineSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length === 0 || b.length === 0) return 0

  const maxLen = Math.max(a.length, b.length)
  const distance = levenshteinDistance(a, b)
  return 1 - distance / maxLen
}

/**
 * 计算两个代码块的相似度
 */
function calculateBlockSimilarity(a: string, b: string): number {
  const aLines = a.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const bLines = b.split('\n').map(l => l.trim()).filter(l => l.length > 0)

  if (aLines.length === 0 || bLines.length === 0) return 0

  let matchingLines = 0
  for (let i = 0; i < Math.min(aLines.length, bLines.length); i++) {
    if (calculateLineSimilarity(aLines[i], bLines[i]) > 0.8) {
      matchingLines++
    }
  }

  return matchingLines / Math.max(aLines.length, bLines.length)
}

/**
 * Levenshtein 距离
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      )
    }
  }

  return matrix[b.length][a.length]
}

// ============================================
// 智能编辑重试
// ============================================

/**
 * 尝试编辑文件，带智能重试
 */
export async function tryEditWithRetry(
  attempt: EditAttempt,
  _context?: Partial<RetryContext>
): Promise<EditResult> {
  const { path, oldString, newString, replaceAll } = attempt

  // 读取文件内容
  const content = await api.file.read(path)
  if (content === null) {
    return {
      success: false,
      error: `File not found: ${path}. Use write_file to create new files.`,
      shouldReread: false,
    }
  }

  const normalizedContent = normalizeLineEndings(content)
  const normalizedOld = normalizeLineEndings(oldString)
  const normalizedNew = normalizeLineEndings(newString)

  // 尝试智能替换
  const result = smartReplace(normalizedContent, normalizedOld, normalizedNew, replaceAll)

  if (result.success) {
    return {
      success: true,
      newContent: result.newContent,
      strategy: result.strategy,
    }
  }

  // 替换失败，分析错误并提供建议
  const errorType = analyzeEditError(result.error, result.errorCode)

  switch (errorType) {
    case 'not_found': {
      // 查找相似内容
      const similar = findSimilarContent(normalizedContent, normalizedOld)
      
      if (similar.found) {
        return {
          success: false,
          error: result.error,
          suggestion: `Found similar content at line ${similar.lineNumber} (${Math.round((similar.similarity || 0) * 100)}% match). ` +
            `The file may have been modified. Use read_file to get the current content.`,
          similarContent: similar.similarText,
          shouldReread: true,
        }
      }

      // 检查是否是空白/缩进问题
      const trimmedOld = normalizedOld.split('\n').map(l => l.trim()).join('\n')
      const trimmedContent = normalizedContent.split('\n').map(l => l.trim()).join('\n')
      
      if (trimmedContent.includes(trimmedOld)) {
        return {
          success: false,
          error: result.error,
          suggestion: 'The content exists but with different whitespace/indentation. ' +
            'Use read_file to get the exact content including whitespace.',
          shouldReread: true,
        }
      }

      return {
        success: false,
        error: result.error,
        suggestion: 'old_string not found. The file may have changed. Use read_file to get the current content.',
        shouldReread: true,
      }
    }

    case 'multiple_matches': {
      return {
        success: false,
        error: result.error,
        suggestion: 'Multiple matches found. Include more surrounding context (2-3 lines before and after) ' +
          'to make the match unique, or use replace_all=true if you want to replace all occurrences.',
        shouldReread: false,
      }
    }

    case 'file_changed': {
      return {
        success: false,
        error: result.error,
        suggestion: 'File has been modified since last read. Use read_file to get the current content.',
        shouldReread: true,
      }
    }

    default: {
      return {
        success: false,
        error: result.error,
        suggestion: 'Edit failed. Try using read_file to verify the file content.',
        shouldReread: true,
      }
    }
  }
}

// ============================================
// 生成修复建议
// ============================================

/**
 * 根据错误生成详细的修复建议
 */
export function generateFixSuggestion(
  errorType: EditErrorType,
  context: {
    path: string
    oldString?: string
    similarContent?: string
    lineNumber?: number
  }
): string {
  const { path, similarContent, lineNumber } = context

  switch (errorType) {
    case 'not_found':
      if (similarContent && lineNumber) {
        return `The exact text was not found, but similar content exists at line ${lineNumber}:\n` +
          `\`\`\`\n${similarContent.slice(0, 200)}${similarContent.length > 200 ? '...' : ''}\n\`\`\`\n` +
          `\nSuggested action: Use \`read_file path="${path}" start_line=${Math.max(1, lineNumber - 5)} end_line=${lineNumber + 5}\` ` +
          `to get the exact content.`
      }
      return `The text was not found in ${path}. ` +
        `Use \`read_file path="${path}"\` to see the current file content.`

    case 'multiple_matches':
      return `Multiple matches found for the text. To fix:\n` +
        `1. Include more context (2-3 lines before and after the change)\n` +
        `2. Or use \`replace_all=true\` if you want to replace all occurrences\n` +
        `3. Or use \`replace_file_content\` with specific line numbers`

    case 'file_not_found':
      return `File ${path} does not exist. Use \`write_file\` to create it.`

    case 'file_changed':
      return `File ${path} has been modified. Use \`read_file\` to get the latest content.`

    case 'permission_denied':
      return `Permission denied for ${path}. Check file permissions.`

    default:
      return `Edit failed. Use \`read_file path="${path}"\` to verify the content.`
  }
}

// ============================================
// 导出
// ============================================

export {
  calculateLineSimilarity,
  calculateBlockSimilarity,
}
