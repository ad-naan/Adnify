/**
 * 健壮的流式 JSON 解析器
 * 用于解析 LLM 流式输出的不完整 JSON，支持自动补全缺失的结构
 */

/**
 * 尝试解析部分 JSON 字符串
 * 使用状态机方法，比简单的正则替换更健壮
 */
export function parsePartialJson(jsonString: string): Record<string, unknown> | null {
  if (!jsonString || jsonString.trim().length === 0) {
    return null
  }

  // 1. 尝试直接解析（最快）
  try {
    return JSON.parse(jsonString)
  } catch {
    // 继续尝试修复
  }

  // 2. 尝试修复并解析
  try {
    const fixed = fixJson(jsonString)
    return JSON.parse(fixed)
  } catch (e) {
    // 3. 如果修复失败，尝试提取已知字段作为最后手段
    return extractKnownFields(jsonString)
  }
}

/**
 * 修复不完整的 JSON 字符串
 * 通过模拟 JSON 解析状态机来补全缺失的结尾
 */
function fixJson(input: string): string {
  let processed = input.trim()

  // 确保以 { 或 [ 开头
  if (!processed.startsWith('{') && !processed.startsWith('[')) {
    const firstBrace = processed.indexOf('{')
    const firstBracket = processed.indexOf('[')

    if (firstBrace === -1 && firstBracket === -1) return '{}'

    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      processed = processed.slice(firstBrace)
    } else {
      processed = processed.slice(firstBracket)
    }
  }

  const stack: ('{' | '[' | '"')[] = []
  let isEscaped = false
  let inString = false

  // 扫描字符串，维护状态栈
  for (let i = 0; i < processed.length; i++) {
    const char = processed[i]

    if (isEscaped) {
      isEscaped = false
      continue
    }

    if (char === '\\') {
      isEscaped = true
      continue
    }

    if (char === '"') {
      if (inString) {
        // 字符串结束
        inString = false
        // 弹出栈顶的引号标记（如果有的话，虽然我们只用 boolean 标记 inString，但为了逻辑一致性）
      } else {
        // 字符串开始
        inString = true
      }
      continue
    }

    if (!inString) {
      if (char === '{') {
        stack.push('{')
      } else if (char === '[') {
        stack.push('[')
      } else if (char === '}') {
        if (stack.length > 0 && stack[stack.length - 1] === '{') {
          stack.pop()
        }
      } else if (char === ']') {
        if (stack.length > 0 && stack[stack.length - 1] === '[') {
          stack.pop()
        }
      }
    }
  }

  // 根据状态栈补全结尾
  let result = processed

  // 1. 如果在字符串中结束，补全引号
  if (inString) {
    // 检查是否以转义符结尾
    if (result.endsWith('\\')) {
      result += '\\' // 补全转义符，变成 \\"
    }
    result += '"'
  }

  // 2. 补全缺失的括号
  while (stack.length > 0) {
    const token = stack.pop()
    if (token === '{') {
      result += '}'
    } else if (token === '[') {
      result += ']'
    }
  }

  return result
}

/**
 * 从严重损坏的 JSON 中提取已知字段
 * 正则表达式回退策略
 */
function extractKnownFields(jsonString: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  // 辅助函数：安全提取字段
  const extract = (key: string) => {
    // 匹配 "key": "value..." 或 "key": value
    // 注意：这只是一个简单的启发式匹配，无法处理复杂的嵌套
    const regex = new RegExp(`"${key}"\\s*:\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|([^,}]+))`)
    const match = jsonString.match(regex)
    if (match) {
      if (match[1] !== undefined) {
        // 字符串值
        try {
          result[key] = JSON.parse(`"${match[1]}"`)
        } catch {
          result[key] = match[1] // 回退到原始字符串
        }
      } else if (match[2] !== undefined) {
        // 非字符串值 (number, boolean, null)
        try {
          result[key] = JSON.parse(match[2])
        } catch {
          result[key] = match[2]
        }
      }
    }
  }

  // 常用工具参数字段
  const commonFields = [
    'path', 'content', 'command', 'query', 'pattern',
    'old_string', 'new_string', 'start_line', 'end_line',
    'line', 'column', 'paths', 'url', 'question'
  ]

  commonFields.forEach(extract)

  return result
}

import { getToolTruncateConfig } from '@shared/config/agentConfig'

/**
 * 智能截断工具结果
 * 根据工具类型和内容特点进行截断，避免 UI 卡顿
 * 
 * 优化：根据内容特征动态调整截断策略
 */
export function truncateToolResult(
  result: string,
  toolName: string,
  maxLength?: number
): string {
  if (!result) return ''

  const config = getToolTruncateConfig(toolName)
  const limit = maxLength || config.maxLength

  if (result.length <= limit) {
    return result
  }

  // 智能检测内容特征，动态调整截断比例
  const { headRatio, tailRatio } = detectContentStrategy(result, toolName, config)

  // 计算截断位置
  const headSize = Math.floor(limit * headRatio)
  const tailSize = Math.floor(limit * tailRatio)
  const omitted = result.length - headSize - tailSize

  // 尝试在行边界截断（更友好的输出）
  // 注意用 sliceHead/sliceTailFrom 而不是裸 slice：非 BMP 字符（emoji、CJK 扩展区）
  // 在 JS 里占两个 code unit，切在中间会留下半个字符。
  const head = truncateAtLineEnd(sliceHead(result, headSize + 200), headSize)
  const tail = truncateAtLineStart(sliceTailFrom(result, result.length - tailSize - 200), tailSize)

  const truncatedMsg = `\n\n... [truncated: ${omitted.toLocaleString()} chars omitted] ...\n\n`

  return head + truncatedMsg + tail
}

/**
 * 检测内容特征，返回最佳截断策略
 */
function detectContentStrategy(
  content: string,
  toolName: string,
  defaultConfig: { headRatio: number; tailRatio: number }
): { headRatio: number; tailRatio: number } {
  // 1. 检测错误信息（通常在末尾）
  const hasError = /error|exception|failed|fatal|panic|traceback|stack trace/i.test(content)
  if (hasError) {
    // 错误信息保留更多尾部
    return { headRatio: 0.25, tailRatio: 0.7 }
  }

  // 2. 检测成功信息（通常在开头或末尾）
  const hasSuccess = /success|completed|done|✓|✔/i.test(content)
  if (hasSuccess && content.length < 5000) {
    // 短成功消息，保留更多头部
    return { headRatio: 0.8, tailRatio: 0.15 }
  }

  // 3. 根据工具类型特殊处理
  switch (toolName) {
    case 'run_command':
    case 'execute_command':
      // 命令输出：错误通常在末尾，保留更多尾部
      return { headRatio: 0.2, tailRatio: 0.75 }

    case 'search_files':
    case 'grep_search':
    case 'codebase_search':
      // 搜索结果：最相关的在前面
      return { headRatio: 0.9, tailRatio: 0.05 }

    case 'read_file':
      // 文件内容：保持平衡，但稍微偏向头部
      return { headRatio: 0.7, tailRatio: 0.25 }

    case 'get_diagnostics':
      // Diagnostics are grouped by source symbol, so retain both ends.
      return { headRatio: 0.6, tailRatio: 0.35 }

    case 'list_directory':
      // 目录列表：保持平衡
      return { headRatio: 0.6, tailRatio: 0.35 }

    default:
      // 使用默认配置
      return defaultConfig
  }
}

/**
 * 在行尾截断（向前找换行符）
 */
/**
 * 代理对安全的切片工具
 *
 * JS 字符串按 UTF-16 code unit 索引，非 BMP 字符（emoji、CJK 扩展区如 U+20000）
 * 占两个 unit。裸 slice 切在这两个 unit 中间就会留下一个孤立代理，渲染成 U+FFFD，
 * 并原样进到发给模型的 tool 消息里 —— 表现就是「工具结果里出现一坨乱码」。
 *
 * 这两个函数只做一件事：把边界从代理对中间挪开一格。宁可少一个字符，
 * 也不要吐出半个字符。
 */

/** 判断该位置是否是一个代理对的低位（即前一个 unit 是高位代理） */
function splitsSurrogatePair(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return false
  const prev = text.charCodeAt(index - 1)
  const curr = text.charCodeAt(index)
  return prev >= 0xd800 && prev <= 0xdbff && curr >= 0xdc00 && curr <= 0xdfff
}

/** 取前 end 个 code unit；若 end 落在代理对中间则往前退一格 */
function sliceHead(text: string, end: number): string {
  if (end >= text.length) return text
  const safeEnd = splitsSurrogatePair(text, end) ? end - 1 : end
  return text.slice(0, Math.max(0, safeEnd))
}

/** 从 start 取到末尾；若 start 落在代理对中间则往后进一格 */
function sliceTailFrom(text: string, start: number): string {
  if (start <= 0) return text
  const safeStart = splitsSurrogatePair(text, start) ? start + 1 : start
  return text.slice(Math.min(safeStart, text.length))
}

function truncateAtLineEnd(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text

  // 在 maxLen 附近找换行符
  const searchStart = Math.max(0, maxLen - 100)
  const lastNewline = text.lastIndexOf('\n', maxLen)

  if (lastNewline > searchStart) {
    return text.slice(0, lastNewline)
  }

  return sliceHead(text, maxLen)
}

/**
 * 在行首截断（向后找换行符）
 */
function truncateAtLineStart(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text

  const startPos = text.length - maxLen
  const searchEnd = Math.min(text.length, startPos + 100)
  const firstNewline = text.indexOf('\n', startPos)

  if (firstNewline !== -1 && firstNewline < searchEnd) {
    // 换行符本身不可能是代理对的一半，所以这个边界天然安全
    return text.slice(firstNewline + 1)
  }

  return sliceTailFrom(text, startPos)
}
