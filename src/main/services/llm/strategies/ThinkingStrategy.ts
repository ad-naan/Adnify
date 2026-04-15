/**
 * Thinking 策略接口
 * 只处理 AI SDK 无法自动处理的特殊情况
 */

export interface ThinkingParseResult {
  thinking: string
  content: string
}

export abstract class ThinkingStrategy {
  /**
   * 解析流式文本（可选）
   * 仅用于 AI SDK 无法自动处理的 thinking 标签格式。
   */
  parseStreamText?(text: string): ThinkingParseResult

  /**
   * 从完整文本中提取 thinking（可选）
   * 用于最终结果的清理
   */
  extractThinking?(text: string): ThinkingParseResult

  /**
   * 重置状态（可选）
   * 用于有状态的解析器
   */
  reset?(): void
}

/**
 * 标准策略 - AI SDK 原生支持，无需特殊处理
 */
export class StandardThinkingStrategy extends ThinkingStrategy {
  // AI SDK 6.0 原生支持 reasoning-delta，无需额外处理
}

export class XmlTagThinkingStrategy extends ThinkingStrategy {
  private buffer = ''
  private inThinkingTag = false

  reset(): void {
    this.buffer = ''
    this.inThinkingTag = false
  }

  parseStreamText(text: string): ThinkingParseResult {
    let thinking = ''
    let content = ''

    this.buffer += text

    while (this.buffer.length > 0) {
      if (this.inThinkingTag) {
        const endIndex = this.buffer.indexOf('</think>')
        if (endIndex !== -1) {
          thinking += this.buffer.substring(0, endIndex)
          this.inThinkingTag = false
          this.buffer = this.buffer.substring(endIndex + 8)
        } else {
          // Check if </think> might be partially arriving at the end of the buffer
          const lastLessThan = this.buffer.lastIndexOf('<')
          if (lastLessThan !== -1 && this.buffer.length - lastLessThan < 8 && '</think>'.startsWith(this.buffer.substring(lastLessThan))) {
            // Buffer ends with a potential </think> prefix
            thinking += this.buffer.substring(0, lastLessThan)
            this.buffer = this.buffer.substring(lastLessThan)
            break // Wait for more chunks to complete the tag
          } else {
            // Safe to flush the entire buffer
            thinking += this.buffer
            this.buffer = ''
          }
        }
      } else {
        const startIndex = this.buffer.indexOf('<think>')
        if (startIndex !== -1) {
          content += this.buffer.substring(0, startIndex)
          this.inThinkingTag = true
          this.buffer = this.buffer.substring(startIndex + 7)
        } else {
          // Check if <think> might be partially arriving at the end of the buffer
          const lastLessThan = this.buffer.lastIndexOf('<')
          if (lastLessThan !== -1 && this.buffer.length - lastLessThan < 7 && '<think>'.startsWith(this.buffer.substring(lastLessThan))) {
            // Buffer ends with a potential <think> prefix
            content += this.buffer.substring(0, lastLessThan)
            this.buffer = this.buffer.substring(lastLessThan)
            break // Wait for more chunks to complete the tag
          } else {
            // Safe to flush the entire buffer
            content += this.buffer
            this.buffer = ''
          }
        }
      }
    }

    return { thinking, content }
  }

  extractThinking(text: string): ThinkingParseResult {
    // Also include any buffered content from the end of the stream
    const fullText = text + this.buffer
    const thinkRegex = /<think>([\s\S]*?)<\/think>/g
    const thinkingParts: string[] = []
    let match: RegExpExecArray | null

    while ((match = thinkRegex.exec(fullText)) !== null) {
      thinkingParts.push(match[1])
    }

    // Check for unclosed <think> tags specifically
    const unclosedMatch = /<think>([\s\S]*)$/.exec(fullText)
    if (unclosedMatch && !fullText.substring(unclosedMatch.index).includes('</think>')) {
      thinkingParts.push(unclosedMatch[1])
    }

    const thinking = thinkingParts.join('\n')
    let content = fullText.replace(/<think>[\s\S]*?<\/think>/g, '')
    content = content.replace(/<think>[\s\S]*$/g, '').trim()

    return { thinking, content }
  }
}

/**
 * 策略工厂
 * 根据 model 名称自动选择策略
 */
export class ThinkingStrategyFactory {
  /**
   * 创建策略
   * 只为需要特殊处理的模型创建策略，其他使用标准策略（AI SDK 原生支持）。
   */
  static create(model: string): ThinkingStrategy {
    const modelLower = model.toLowerCase()

    // 需要解析 think 标签的模型。
    if (/minimax|abab|deepseek|r1|reason/i.test(modelLower)) {
      return new XmlTagThinkingStrategy()
    }

    // 其他所有模型使用标准策略（AI SDK 原生支持）
    // 包括：Anthropic Claude, OpenAI o1/o3, DeepSeek Reasoner, Google Gemini Thinking
    return new StandardThinkingStrategy()
  }
}
