import type { LspTextEdit, LspWorkspaceEdit } from '@shared/types'

function positionToOffset(content: string, line: number, character: number): number {
  if (!Number.isInteger(line) || !Number.isInteger(character) || line < 0 || character < 0) {
    throw new Error(`Invalid LSP position: ${line}:${character}`)
  }

  let currentLine = 0
  let lineStart = 0
  while (currentLine < line) {
    const newline = content.indexOf('\n', lineStart)
    if (newline < 0) throw new Error(`LSP line ${line} is outside the document`)
    lineStart = newline + 1
    currentLine++
  }

  const newline = content.indexOf('\n', lineStart)
  let lineEnd = newline < 0 ? content.length : newline
  if (lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === 13) lineEnd--
  if (lineStart + character > lineEnd) {
    throw new Error(`LSP character ${character} is outside line ${line}`)
  }
  return lineStart + character
}

export function applyLspTextEdits(content: string, edits: LspTextEdit[]): string {
  const resolved = edits.map(edit => {
    const start = positionToOffset(content, edit.range.start.line, edit.range.start.character)
    const end = positionToOffset(content, edit.range.end.line, edit.range.end.character)
    if (end < start) throw new Error('LSP edit range ends before it starts')
    return { start, end, newText: edit.newText }
  }).sort((a, b) => b.start - a.start || b.end - a.end)

  let nextBoundary = content.length
  let result = content
  for (const edit of resolved) {
    if (edit.end > nextBoundary) throw new Error('Overlapping LSP text edits are not supported')
    result = result.slice(0, edit.start) + edit.newText + result.slice(edit.end)
    nextBoundary = edit.start
  }
  return result
}

export function collectWorkspaceTextEdits(edit: LspWorkspaceEdit): Map<string, LspTextEdit[]> {
  const collected = new Map<string, LspTextEdit[]>()
  const add = (uri: string, edits: LspTextEdit[]) => {
    collected.set(uri, [...(collected.get(uri) ?? []), ...edits])
  }

  for (const [uri, edits] of Object.entries(edit.changes ?? {})) add(uri, edits)
  for (const change of edit.documentChanges ?? []) {
    if (!change || typeof change !== 'object' || !('textDocument' in change) || !('edits' in change)) {
      throw new Error('Workspace resource operations are not supported')
    }
    add(change.textDocument.uri, change.edits)
  }
  return collected
}
