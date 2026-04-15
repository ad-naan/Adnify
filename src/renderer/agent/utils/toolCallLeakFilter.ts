const TOOL_LEAK_TAGS = [
  'tool_call',
  'tool_calls',
  'function_call',
  'function_calls',
] as const

interface ToolLeakTagSpec {
  name: string
  openPattern: RegExp
  closePattern: RegExp
}

const TOOL_LEAK_SPECS: ToolLeakTagSpec[] = TOOL_LEAK_TAGS.map(name => ({
  name,
  openPattern: new RegExp(`<${name}(?:\\s[^>]*)?>`, 'i'),
  closePattern: new RegExp(`</${name}>`, 'i'),
}))

export interface ToolCallLeakFilterResult {
  visibleText: string
  buffer: string
}

function findNextOpenTagIndex(text: string, startIndex: number): number {
  let nextIndex = -1

  for (const spec of TOOL_LEAK_SPECS) {
    const slice = text.slice(startIndex)
    const match = spec.openPattern.exec(slice)
    if (!match || typeof match.index !== 'number') continue

    const absoluteIndex = startIndex + match.index
    if (nextIndex === -1 || absoluteIndex < nextIndex) {
      nextIndex = absoluteIndex
    }
  }

  return nextIndex
}

function resolveOpenTag(text: string, startIndex: number): { spec: ToolLeakTagSpec; openTagEnd: number } | null {
  const slice = text.slice(startIndex)

  for (const spec of TOOL_LEAK_SPECS) {
    const match = spec.openPattern.exec(slice)
    if (match && match.index === 0) {
      return {
        spec,
        openTagEnd: startIndex + match[0].length,
      }
    }
  }

  return null
}

export function filterToolCallLeakChunk(chunk: string, buffered = ''): ToolCallLeakFilterResult {
  const combined = buffered + chunk
  let visibleText = ''
  let cursor = 0

  while (cursor < combined.length) {
    const nextOpenIndex = findNextOpenTagIndex(combined, cursor)
    if (nextOpenIndex === -1) {
      visibleText += combined.slice(cursor)
      return { visibleText, buffer: '' }
    }

    visibleText += combined.slice(cursor, nextOpenIndex)

    const openTag = resolveOpenTag(combined, nextOpenIndex)
    if (!openTag) {
      visibleText += combined.slice(nextOpenIndex, nextOpenIndex + 1)
      cursor = nextOpenIndex + 1
      continue
    }

    const closingSlice = combined.slice(openTag.openTagEnd)
    const closeMatch = openTag.spec.closePattern.exec(closingSlice)
    if (!closeMatch || typeof closeMatch.index !== 'number') {
      return { visibleText, buffer: combined.slice(nextOpenIndex) }
    }

    cursor = openTag.openTagEnd + closeMatch.index + closeMatch[0].length
  }

  return { visibleText, buffer: '' }
}

export function stripToolCallLeaks(text: string): string {
  if (!text) return ''

  let sanitized = text

  for (const spec of TOOL_LEAK_SPECS) {
    sanitized = sanitized
      .replace(new RegExp(`<${spec.name}(?:\\s[^>]*)?>[\\s\\S]*?</${spec.name}>`, 'gi'), '')
      .replace(new RegExp(`<${spec.name}(?:\\s[^>]*)?>[\\s\\S]*$`, 'gi'), '')
  }

  return sanitized.trim()
}
