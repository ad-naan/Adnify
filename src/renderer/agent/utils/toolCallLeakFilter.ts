import { TOOL_CALL_MARKUP_TAGS, type ToolCallMarkupTag } from '@shared/utils/toolCallMarkup'

const TOOL_LEAK_TAGS = TOOL_CALL_MARKUP_TAGS

type ToolLeakTagName = ToolCallMarkupTag
const MAX_OPENING_PREFIX_LENGTH = Math.max(...TOOL_LEAK_TAGS.map(name => name.length + 1))

type OpeningTagResolution =
  | { type: 'match'; name: ToolLeakTagName; endIndex: number }
  | { type: 'await-end'; name: ToolLeakTagName }
  | { type: 'incomplete' }
  | { type: 'none' }

function resolveOpeningTag(text: string, startIndex: number): OpeningTagResolution {
  for (const name of TOOL_LEAK_TAGS) {
    const prefix = `<${name}`
    if (text.slice(startIndex, startIndex + prefix.length).toLowerCase() !== prefix) continue

    const delimiter = text[startIndex + prefix.length]
    if (delimiter === undefined) return { type: 'incomplete' }
    if (delimiter === '>') {
      return { type: 'match', name, endIndex: startIndex + prefix.length + 1 }
    }
    if (/\s/.test(delimiter)) {
      const endIndex = text.indexOf('>', startIndex + prefix.length + 1)
      return endIndex === -1
        ? { type: 'await-end', name }
        : { type: 'match', name, endIndex: endIndex + 1 }
    }
  }

  const possiblePrefix = text.slice(startIndex, startIndex + MAX_OPENING_PREFIX_LENGTH).toLowerCase()
  if (TOOL_LEAK_TAGS.some(name => `<${name}`.startsWith(possiblePrefix))) {
    return { type: 'incomplete' }
  }

  return { type: 'none' }
}

function longestClosingPrefix(text: string, closingTag: string): string {
  const maxLength = Math.min(text.length, closingTag.length - 1)
  const tail = text.slice(-maxLength)
  const normalizedTail = tail.toLowerCase()

  for (let length = maxLength; length > 0; length--) {
    if (closingTag.startsWith(normalizedTail.slice(-length))) {
      return tail.slice(-length)
    }
  }

  return ''
}

function findClosingTag(text: string, closingTag: string): number {
  let index = text.indexOf('<')

  while (index !== -1) {
    if (text.slice(index, index + closingTag.length).toLowerCase() === closingTag) {
      return index
    }
    index = text.indexOf('<', index + 1)
  }

  return -1
}

/**
 * Removes provider tool-call markup from streamed text without retaining the
 * hidden payload. State is bounded to partial opening/closing tag markers.
 */
export class ToolCallLeakFilter {
  private pendingVisible = ''
  private hiddenClosingTag: string | null = null
  private awaitingOpeningTagEnd = false
  private pendingHidden = ''

  consume(chunk: string): string {
    let input = this.pendingVisible + chunk
    let visibleText = ''
    this.pendingVisible = ''

    while (input) {
      if (this.hiddenClosingTag) {
        if (this.awaitingOpeningTagEnd) {
          const openingEnd = input.indexOf('>')
          if (openingEnd === -1) return visibleText
          input = input.slice(openingEnd + 1)
          this.awaitingOpeningTagEnd = false
          continue
        }

        const hiddenInput = this.pendingHidden + input
        const closingIndex = findClosingTag(hiddenInput, this.hiddenClosingTag)
        if (closingIndex === -1) {
          this.pendingHidden = longestClosingPrefix(hiddenInput, this.hiddenClosingTag)
          return visibleText
        }

        input = hiddenInput.slice(closingIndex + this.hiddenClosingTag.length)
        this.hiddenClosingTag = null
        this.pendingHidden = ''
        continue
      }

      const openingIndex = input.indexOf('<')
      if (openingIndex === -1) return visibleText + input

      visibleText += input.slice(0, openingIndex)
      const openingTag = resolveOpeningTag(input, openingIndex)

      if (openingTag.type === 'incomplete') {
        this.pendingVisible = input.slice(openingIndex)
        return visibleText
      }
      if (openingTag.type === 'none') {
        visibleText += '<'
        input = input.slice(openingIndex + 1)
        continue
      }

      this.hiddenClosingTag = `</${openingTag.name}>`
      if (openingTag.type === 'await-end') {
        this.awaitingOpeningTagEnd = true
        return visibleText
      }
      input = input.slice(openingTag.endIndex)
    }

    return visibleText
  }

  finalize(): string {
    const trailingText = this.hiddenClosingTag ? '' : this.pendingVisible
    this.pendingVisible = ''
    this.hiddenClosingTag = null
    this.awaitingOpeningTagEnd = false
    this.pendingHidden = ''
    return trailingText
  }
}

export function stripToolCallLeaks(text: string): string {
  if (!text) return ''

  const filter = new ToolCallLeakFilter()
  return `${filter.consume(text)}${filter.finalize()}`.trim()
}
