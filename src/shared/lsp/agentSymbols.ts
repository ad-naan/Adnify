import type { AgentSymbol, LspDocumentSymbol, LspRange } from '@shared/types'

const SYMBOL_KIND_NAMES: Record<number, string> = {
  1: 'File',
  2: 'Module',
  3: 'Namespace',
  4: 'Package',
  5: 'Class',
  6: 'Method',
  7: 'Property',
  8: 'Field',
  9: 'Constructor',
  10: 'Enum',
  11: 'Interface',
  12: 'Function',
  13: 'Variable',
  14: 'Constant',
  15: 'String',
  16: 'Number',
  17: 'Boolean',
  18: 'Array',
  19: 'Object',
  20: 'Key',
  21: 'Null',
  22: 'EnumMember',
  23: 'Struct',
  24: 'Event',
  25: 'Operator',
  26: 'TypeParameter',
}

function toOneBasedRange(range: LspRange): AgentSymbol['range'] {
  return {
    start: { line: range.start.line + 1, column: range.start.character + 1 },
    end: { line: range.end.line + 1, column: range.end.character + 1 },
  }
}

function addOverloadIndexes(symbols: LspDocumentSymbol[]): Array<{ symbol: LspDocumentSymbol; segment: string }> {
  const totals = new Map<string, number>()
  const seen = new Map<string, number>()

  for (const symbol of symbols) {
    totals.set(symbol.name, (totals.get(symbol.name) ?? 0) + 1)
  }

  return symbols.map(symbol => {
    const index = seen.get(symbol.name) ?? 0
    seen.set(symbol.name, index + 1)
    return {
      symbol,
      segment: (totals.get(symbol.name) ?? 0) > 1 ? `${symbol.name}[${index}]` : symbol.name,
    }
  })
}

/** Converts raw LSP symbols into stable name paths that an agent can address without line arithmetic. */
export function toAgentSymbols(
  symbols: LspDocumentSymbol[],
  relativePath: string,
  parentNamePath = '',
): AgentSymbol[] {
  return addOverloadIndexes(symbols).map(({ symbol, segment }) => {
    const namePath = parentNamePath ? `${parentNamePath}/${segment}` : segment
    const children = symbol.children?.length
      ? toAgentSymbols(symbol.children, relativePath, namePath)
      : undefined

    return {
      name: symbol.name,
      namePath,
      kind: symbol.kind,
      kindName: SYMBOL_KIND_NAMES[symbol.kind] ?? `SymbolKind(${symbol.kind})`,
      relativePath,
      range: toOneBasedRange(symbol.range),
      selectionRange: toOneBasedRange(symbol.selectionRange),
      ...(symbol.detail ? { detail: symbol.detail } : {}),
      ...(children ? { children } : {}),
    }
  })
}

function flattenSymbols(symbols: AgentSymbol[]): AgentSymbol[] {
  return symbols.flatMap(symbol => [symbol, ...flattenSymbols(symbol.children ?? [])])
}

function stripLeadingSlash(value: string): string {
  return value.startsWith('/') ? value.slice(1) : value
}

/** Accepts the slash form used in tool output and the dotted form models commonly produce. */
export function normalizeAgentNamePathPattern(value: string): string {
  const trimmed = value.trim()
  return trimmed.includes('/') ? trimmed : trimmed.replace(/\./g, '/')
}

function matchesNamePath(symbol: AgentSymbol, pattern: string, substringMatching: boolean): boolean {
  pattern = normalizeAgentNamePathPattern(pattern)
  const absolute = pattern.startsWith('/')
  const normalizedPattern = stripLeadingSlash(pattern)

  if (substringMatching) {
    const patternParts = normalizedPattern.split('/')
    const symbolParts = symbol.namePath.split('/')
    const expectedParent = patternParts.slice(0, -1).join('/')
    const actualParent = symbolParts.slice(0, -1).join('/')
    const nameMatches = symbol.name.includes(patternParts.at(-1) ?? '')
    if (!nameMatches) return false
    if (!expectedParent) return true
    return absolute ? actualParent === expectedParent : actualParent.endsWith(expectedParent)
  }

  if (absolute) return symbol.namePath === normalizedPattern
  if (!normalizedPattern.includes('/')) {
    return symbol.name === normalizedPattern || symbol.namePath.split('/').at(-1) === normalizedPattern
  }
  return symbol.namePath === normalizedPattern || symbol.namePath.endsWith(`/${normalizedPattern}`)
}

function limitDepth(symbol: AgentSymbol, depth: number): AgentSymbol {
  const { children, ...base } = symbol
  if (depth <= 0 || !children?.length) return base
  return {
    ...base,
    children: children.map(child => limitDepth(child, depth - 1)),
  }
}

export function limitAgentSymbolDepth(symbols: AgentSymbol[], depth: number): AgentSymbol[] {
  const normalizedDepth = Math.max(0, depth)
  return symbols.map(symbol => limitDepth(symbol, normalizedDepth))
}

export function findAgentSymbols(
  symbolTrees: AgentSymbol[],
  namePathPattern: string,
  options: { depth?: number; substringMatching?: boolean } = {},
): AgentSymbol[] {
  const depth = Math.max(0, options.depth ?? 0)
  return flattenSymbols(symbolTrees)
    .filter(symbol => matchesNamePath(symbol, namePathPattern, options.substringMatching ?? false))
    .map(symbol => limitDepth(symbol, depth))
}

function positionWithinRange(line: number, column: number, range: AgentSymbol['range']): boolean {
  const afterStart = line > range.start.line || (line === range.start.line && column >= range.start.column)
  const beforeEnd = line < range.end.line || (line === range.end.line && column <= range.end.column)
  return afterStart && beforeEnd
}

/** Returns the deepest symbol containing a one-based source position. */
export function findContainingAgentSymbol(
  symbolTrees: AgentSymbol[],
  line: number,
  column: number,
): AgentSymbol | null {
  let best: AgentSymbol | null = null
  for (const symbol of flattenSymbols(symbolTrees)) {
    if (!positionWithinRange(line, column, symbol.range)) continue
    if (!best || symbol.namePath.split('/').length > best.namePath.split('/').length) best = symbol
  }
  return best ? limitDepth(best, 0) : null
}

/** Extracts an LSP range while preserving the source file's original line endings. */
export function extractLspRange(content: string, range: AgentSymbol['range']): string {
  const lines = content.match(/.*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) ?? []
  const offsets: number[] = [0]
  for (const line of lines) offsets.push(offsets.at(-1)! + line.length)

  const startLine = Math.max(0, range.start.line - 1)
  const endLine = Math.max(0, range.end.line - 1)
  const start = Math.min(content.length, (offsets[startLine] ?? content.length) + range.start.column - 1)
  const end = Math.min(content.length, (offsets[endLine] ?? content.length) + range.end.column - 1)
  return content.slice(start, Math.max(start, end))
}
