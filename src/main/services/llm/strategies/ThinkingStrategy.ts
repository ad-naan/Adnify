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
   * 仅用于 AI SDK 无法自动处理的格式（如 MiniMax 的 XML 标签）
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

/**
 * XML Tag 策略 (如 MiniMax, DeepSeek-R1, 本地 Ollama 推理模型)
 * 使用 <think> 标签包裹思考内容，需要手动解析
 */
export class XmlTagThinkingStrategy extends ThinkingStrategy {
  private thinkingBuffer = ''
  private inThinkingTag = false

  reset(): void {
    this.thinkingBuffer = ''
    this.inThinkingTag = false
  }

  parseStreamText(text: string): ThinkingParseResult {
    let thinking = ''
    let content = ''
    let remaining = text

    while (remaining.length > 0) {
      if (this.inThinkingTag) {
        const endIndex = remaining.indexOf('</think>')
        if (endIndex !== -1) {
          thinking = remaining.substring(0, endIndex)
          this.thinkingBuffer += thinking
          this.inThinkingTag = false
          remaining = remaining.substring(endIndex + 8)
        } else {
          this.thinkingBuffer += remaining
          thinking = remaining
          remaining = ''
        }
      } else {
        const startIndex = remaining.indexOf('<think>')
        if (startIndex !== -1) {
          if (startIndex > 0) {
            content = remaining.substring(0, startIndex)
          }
          this.inThinkingTag = true
          this.thinkingBuffer = ''
          remaining = remaining.substring(startIndex + 7)
        } else {
          content = remaining
          remaining = ''
        }
      }
    }

    return { thinking, content }
  }

  extractThinking(text: string): ThinkingParseResult {
    const thinkRegex = /<think>([\s\S]*?)<\/think>/g
    const thinkingParts: string[] = []
    let match: RegExpExecArray | null

    while ((match = thinkRegex.exec(text)) !== null) {
      thinkingParts.push(match[1])
    }

    const thinking = thinkingParts.join('\n')
    const content = text.replace(thinkRegex, '').trim()

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
   * 只为需要特殊处理的模型创建策略，其他使用标准策略（AI SDK 原生支持）
   */
  static create(model: string): ThinkingStrategy {
    const modelLower = model.toLowerCase()

    // 需要解析 XML 标签的模型（包括 MiniMax 2.1, DeepSeek-R1, 本地 Ollama, 第三方中转）
    if (/minimax.*2\.1|abab.*7|deepseek|r1|reason/i.test(modelLower)) {
      return new XmlTagThinkingStrategy()
    }

    // 其他所有模型使用标准策略（AI SDK 原生支持）
    // 包括：Anthropic Claude, OpenAI o1/o3, DeepSeek Reasoner, Google Gemini Thinking
    return new StandardThinkingStrategy()
  }
}
