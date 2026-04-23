const STREAMABLE_TOOL_ARG_KEYS = new Set([
  'path',
  'command',
  'query',
  'pattern',
  'url',
  'cwd',
  'line',
  'column',
  'start_line',
  'end_line',
  'after_line',
  'terminal_id',
  'file_pattern',
  'is_background',
  'timeout',
  'refresh',
  'old_string',
  'new_string',
  'content',
  'code',
  'replacement',
  'source',
])

const PARTIAL_ARGS_SCAN_LIMIT = 16384

function decodeJsonStringFragment(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

function extractPartialStringField(scanTarget: string, key: string): string | null {
  const marker = `"${key}":`
  const keyIndex = scanTarget.lastIndexOf(marker)
  if (keyIndex === -1) return null

  let cursor = keyIndex + marker.length
  while (cursor < scanTarget.length && /\s/.test(scanTarget[cursor])) {
    cursor++
  }

  if (scanTarget[cursor] !== '"') {
    return null
  }

  cursor++
  let value = ''
  let escaped = false

  while (cursor < scanTarget.length) {
    const ch = scanTarget[cursor]

    if (escaped) {
      value += ch
      escaped = false
      cursor++
      continue
    }

    if (ch === '\\') {
      value += ch
      escaped = true
      cursor++
      continue
    }

    if (ch === '"') {
      break
    }

    value += ch
    cursor++
  }

  return value
}

function extractJsonObjectSlice(source: string, startIndex: number): { slice: string; complete: boolean } | null {
  if (source[startIndex] !== '{') return null

  let cursor = startIndex
  let depth = 0
  let inString = false
  let escaped = false

  while (cursor < source.length) {
    const ch = source[cursor]

    if (escaped) {
      escaped = false
      cursor++
      continue
    }

    if (ch === '\\') {
      escaped = true
      cursor++
      continue
    }

    if (ch === '"') {
      inString = !inString
      cursor++
      continue
    }

    if (!inString) {
      if (ch === '{') depth++
      if (ch === '}') {
        depth--
        if (depth === 0) {
          return {
            slice: source.slice(startIndex, cursor + 1),
            complete: true,
          }
        }
      }
    }

    cursor++
  }

  return {
    slice: source.slice(startIndex),
    complete: false,
  }
}

function parsePartialEditObject(fragment: string): Record<string, unknown> | null {
  const actionMatch = fragment.match(/"action":\s*"(replace|insert|delete)"/)
  if (!actionMatch) return null

  const preview: Record<string, unknown> = {
    action: actionMatch[1],
  }

  const startLineMatch = fragment.match(/"start_line":\s*(-?\d+(?:\.\d+)?)/)
  if (startLineMatch) preview.start_line = parseFloat(startLineMatch[1])

  const endLineMatch = fragment.match(/"end_line":\s*(-?\d+(?:\.\d+)?)/)
  if (endLineMatch) preview.end_line = parseFloat(endLineMatch[1])

  const afterLineMatch = fragment.match(/"after_line":\s*(-?\d+(?:\.\d+)?)/)
  if (afterLineMatch) preview.after_line = parseFloat(afterLineMatch[1])

  const partialContent = extractPartialStringField(fragment, 'content')
  if (partialContent !== null) {
    preview.content = decodeJsonStringFragment(partialContent)
  }

  return preview
}

function extractPartialEditsField(scanTarget: string): Record<string, unknown>[] | null {
  const editsKeyIndex = scanTarget.lastIndexOf('"edits"')
  if (editsKeyIndex === -1) return null

  const arrayStart = scanTarget.indexOf('[', editsKeyIndex)
  if (arrayStart === -1) return null

  const edits: Record<string, unknown>[] = []
  let cursor = arrayStart + 1

  while (cursor < scanTarget.length) {
    const ch = scanTarget[cursor]

    if (/\s|,/.test(ch)) {
      cursor++
      continue
    }

    if (ch === ']') {
      break
    }

    if (ch !== '{') {
      cursor++
      continue
    }

    const objectSlice = extractJsonObjectSlice(scanTarget, cursor)
    if (!objectSlice) break

    if (objectSlice.complete) {
      try {
        const parsed = JSON.parse(objectSlice.slice)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.action === 'string') {
          edits.push(parsed as Record<string, unknown>)
        }
      } catch {
        const partial = parsePartialEditObject(objectSlice.slice)
        if (partial) edits.push(partial)
      }
      cursor += objectSlice.slice.length
      continue
    }

    const partial = parsePartialEditObject(objectSlice.slice)
    if (partial) edits.push(partial)
    break
  }

  return edits.length > 0 ? edits : null
}

export function arePartialArgsEqual(
  left?: Record<string, unknown>,
  right?: Record<string, unknown>
): boolean {
  if (left === right) return true
  if (!left || !right) return !left && !right

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false

  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false
    }
  }

  return true
}

export function parseFinalJsonArgs(argsString: string): Record<string, unknown> | null {
  if (!argsString) return null

  try {
    const parsed = JSON.parse(argsString)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

export function parsePartialJsonArgs(argsString: string): Record<string, unknown> | null {
  if (!argsString) return null

  const scanTarget = argsString.length > PARTIAL_ARGS_SCAN_LIMIT
    ? argsString.slice(0, PARTIAL_ARGS_SCAN_LIMIT)
    : argsString

  try {
    const parsed = JSON.parse(scanTarget)
    if (!parsed || typeof parsed !== 'object') return null

    const parsedRecord = parsed as Record<string, unknown>
    const filtered = Object.fromEntries(
      Object.entries(parsedRecord).filter(([key, value]) =>
        STREAMABLE_TOOL_ARG_KEYS.has(key) && typeof value !== 'object'
      )
    )

    if (Array.isArray(parsedRecord.edits)) {
      filtered.edits = parsedRecord.edits
    }

    return Object.keys(filtered).length > 0 ? filtered : null
  } catch {
    const result: Record<string, unknown> = {}

    const stringFieldRegex = /"(\w+)":\s*"((?:[^"\\]|\\.)*)"/g
    let match
    while ((match = stringFieldRegex.exec(scanTarget)) !== null) {
      if (!STREAMABLE_TOOL_ARG_KEYS.has(match[1])) continue
      try {
        result[match[1]] = JSON.parse(`"${match[2]}"`)
      } catch {
        result[match[1]] = decodeJsonStringFragment(match[2])
      }
    }

    for (const key of STREAMABLE_TOOL_ARG_KEYS) {
      if (Object.prototype.hasOwnProperty.call(result, key)) continue

      const partialValue = extractPartialStringField(scanTarget, key)
      if (partialValue === null) continue

      result[key] = decodeJsonStringFragment(partialValue)
    }

    const boolFieldRegex = /"(\w+)":\s*(true|false)/g
    while ((match = boolFieldRegex.exec(scanTarget)) !== null) {
      if (!STREAMABLE_TOOL_ARG_KEYS.has(match[1])) continue
      result[match[1]] = match[2] === 'true'
    }

    const numFieldRegex = /"(\w+)":\s*(-?\d+(?:\.\d+)?)/g
    while ((match = numFieldRegex.exec(scanTarget)) !== null) {
      if (!STREAMABLE_TOOL_ARG_KEYS.has(match[1])) continue
      result[match[1]] = parseFloat(match[2])
    }

    const edits = extractPartialEditsField(scanTarget)
    if (edits) {
      result.edits = edits
    }

    return Object.keys(result).length > 0 ? result : null
  }
}
