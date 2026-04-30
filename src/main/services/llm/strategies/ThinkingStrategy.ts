/**
 * Thinking strategy abstraction for provider-specific reasoning wrappers that
 * are not emitted through AI SDK native reasoning events.
 */

export interface ThinkingParseResult {
  thinking: string
  content: string
}

export abstract class ThinkingStrategy {
  parseStreamText?(text: string): ThinkingParseResult

  extractThinking?(text: string): ThinkingParseResult

  reset?(): void
}

export class StandardThinkingStrategy extends ThinkingStrategy {
  // AI SDK native reasoning events need no extra processing.
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
          const lastLessThan = this.buffer.lastIndexOf('<')
          if (lastLessThan !== -1 && this.buffer.length - lastLessThan < 8 && '</think>'.startsWith(this.buffer.substring(lastLessThan))) {
            thinking += this.buffer.substring(0, lastLessThan)
            this.buffer = this.buffer.substring(lastLessThan)
            break
          }

          thinking += this.buffer
          this.buffer = ''
        }
      } else {
        const startIndex = this.buffer.indexOf('<think>')
        if (startIndex !== -1) {
          content += this.buffer.substring(0, startIndex)
          this.inThinkingTag = true
          this.buffer = this.buffer.substring(startIndex + 7)
        } else {
          const lastLessThan = this.buffer.lastIndexOf('<')
          if (lastLessThan !== -1 && this.buffer.length - lastLessThan < 7 && '<think>'.startsWith(this.buffer.substring(lastLessThan))) {
            content += this.buffer.substring(0, lastLessThan)
            this.buffer = this.buffer.substring(lastLessThan)
            break
          }

          content += this.buffer
          this.buffer = ''
        }
      }
    }

    return { thinking, content }
  }

  extractThinking(text: string): ThinkingParseResult {
    const fullText = text + this.buffer
    const thinkRegex = /<think>([\s\S]*?)<\/think>/g
    const thinkingParts: string[] = []
    let match: RegExpExecArray | null

    while ((match = thinkRegex.exec(fullText)) !== null) {
      thinkingParts.push(match[1])
    }

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

export class ThinkingStrategyFactory {
  static create(tagFormat: 'native' | 'xml-think' = 'native'): ThinkingStrategy {
    if (tagFormat === 'xml-think') {
      return new XmlTagThinkingStrategy()
    }

    return new StandardThinkingStrategy()
  }
}
