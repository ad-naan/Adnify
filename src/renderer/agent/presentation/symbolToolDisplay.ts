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

    return values.flatMap((value) => {
      const symbol = asRecord(value)
      if (!symbol) return []
      const name = typeof symbol.name === 'string' ? symbol.name : ''
      const namePath = typeof symbol.namePath === 'string' ? symbol.namePath : name
      if (!namePath) return []
      const range = asRecord(symbol.range)
      const start = asRecord(range?.start)
      return [{
        name: name || namePath.split('/').at(-1) || namePath,
        namePath,
        ...(typeof symbol.kindName === 'string' ? { kindName: symbol.kindName } : {}),
        ...(typeof symbol.relativePath === 'string' ? { relativePath: symbol.relativePath } : {}),
        ...(typeof start?.line === 'number' ? { line: start.line } : {}),
        ...(typeof symbol.body === 'string' ? { body: symbol.body } : {}),
      }]
    })
  } catch {
    return []
  }
}
