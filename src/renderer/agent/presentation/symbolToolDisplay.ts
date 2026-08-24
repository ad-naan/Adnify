export interface SymbolToolPreviewItem {
  name: string
  namePath: string
  kindName?: string
  relativePath?: string
  line?: number
  body?: string
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? value as Record<string, unknown> : null

export function parseSymbolToolResult(result: string): SymbolToolPreviewItem[] {
  if (!result.trim()) return []

  try {
    const parsed = JSON.parse(result) as unknown
    const record = asRecord(parsed)
    const values = Array.isArray(parsed) ? parsed : Array.isArray(record?.symbols) ? record.symbols : []
    const inheritedPath = typeof record?.relativePath === 'string' ? record.relativePath : undefined

    const visit = (value: unknown, parentPath?: string): SymbolToolPreviewItem[] => {
      const symbol = asRecord(value)
      if (!symbol) return []
      const name = typeof symbol.name === 'string' ? symbol.name : ''
      const namePath = typeof symbol.namePath === 'string' ? symbol.namePath : name
      if (!namePath) return []
      const range = asRecord(symbol.range)
      const start = asRecord(range?.start)
      const location = typeof symbol.location === 'string' ? symbol.location : ''
      const locationMatch = location.match(/^(.*):(\d+):(\d+)-(\d+):(\d+)$/)
      const compactRangeMatch = typeof symbol.range === 'string'
        ? symbol.range.match(/^(\d+):(\d+)-(\d+):(\d+)$/)
        : null
      const relativePath = typeof symbol.relativePath === 'string'
        ? symbol.relativePath
        : locationMatch?.[1] || parentPath
      const item: SymbolToolPreviewItem = {
        name: name || namePath.split('/').at(-1) || namePath,
        namePath,
        ...(typeof symbol.kindName === 'string'
          ? { kindName: symbol.kindName }
          : typeof symbol.kind === 'string' ? { kindName: symbol.kind } : {}),
        ...(relativePath ? { relativePath } : {}),
        ...(typeof start?.line === 'number'
          ? { line: start.line }
          : locationMatch ? { line: Number(locationMatch[2]) }
            : compactRangeMatch ? { line: Number(compactRangeMatch[1]) } : {}),
        ...(typeof symbol.body === 'string' ? { body: symbol.body } : {}),
      }
      const children = Array.isArray(symbol.children)
        ? symbol.children.flatMap(child => visit(child, relativePath))
        : []
      return [item, ...children]
    }

    return values.flatMap(value => visit(value, inheritedPath))
  } catch {
    return []
  }
}
