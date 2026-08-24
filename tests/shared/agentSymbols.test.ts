import { describe, expect, it } from 'vitest'
import { compactAgentSymbols, extractLspRange, findAgentSymbols, findContainingAgentSymbol, toAgentSymbols } from '@shared/lsp/agentSymbols'
import type { LspDocumentSymbol } from '@shared/types'

const range = (startLine: number, startCharacter: number, endLine: number, endCharacter: number) => ({
  start: { line: startLine, character: startCharacter },
  end: { line: endLine, character: endCharacter },
})

const symbols: LspDocumentSymbol[] = [{
  name: 'UserService',
  kind: 5,
  range: range(0, 0, 7, 1),
  selectionRange: range(0, 6, 0, 17),
  children: [
    { name: 'find', kind: 6, range: range(1, 2, 3, 3), selectionRange: range(1, 8, 1, 12) },
    { name: 'find', kind: 6, range: range(4, 2, 6, 3), selectionRange: range(4, 8, 4, 12) },
  ],
}]

describe('agent symbols', () => {
  it('builds stable name paths, overload indexes, and one-based locations', () => {
    const result = toAgentSymbols(symbols, 'src/user.ts')

    expect(result[0].namePath).toBe('UserService')
    expect(result[0].range.start).toEqual({ line: 1, column: 1 })
    expect(result[0].children?.map(symbol => symbol.namePath)).toEqual([
      'UserService/find[0]',
      'UserService/find[1]',
    ])
  })

  it('finds relative and absolute name paths without exposing unwanted descendants', () => {
    const tree = toAgentSymbols(symbols, 'src/user.ts')

    expect(findAgentSymbols(tree, 'find[1]')[0].namePath).toBe('UserService/find[1]')
    expect(findAgentSymbols(tree, '/UserService/find[0]')[0].children).toBeUndefined()
    expect(findAgentSymbols(tree, 'User', { substringMatching: true })[0].namePath).toBe('UserService')
    expect(findAgentSymbols(tree, 'UserService.find[1]')[0].namePath).toBe('UserService/find[1]')
  })

  it('extracts exact symbol bodies with CRLF line endings', () => {
    const content = 'class UserService {\r\n  find() {\r\n    return 1\r\n  }\r\n}\r\n'
    const body = extractLspRange(content, {
      start: { line: 2, column: 3 },
      end: { line: 4, column: 4 },
    })

    expect(body).toBe('find() {\r\n    return 1\r\n  }')
  })

  it('maps a reference position to its deepest containing symbol', () => {
    const tree = toAgentSymbols(symbols, 'src/user.ts')

    expect(findContainingAgentSymbol(tree, 3, 8)?.namePath).toBe('UserService/find[0]')
    expect(findContainingAgentSymbol(tree, 8, 1)?.namePath).toBe('UserService')
    expect(findContainingAgentSymbol(tree, 20, 1)).toBeNull()
  })

  it('keeps precise internal symbols but emits compact read-only results', () => {
    const tree = toAgentSymbols(symbols, 'src/user.ts')
    const compact = compactAgentSymbols(tree, { includeLocation: true })

    expect(compact[0]).toMatchObject({
      namePath: 'UserService',
      kind: 'Class',
      range: '1:1-8:2',
      location: 'src/user.ts:1:1-8:2',
    })
    expect(compact[0]).not.toHaveProperty('name')
    expect(compact[0]).not.toHaveProperty('selectionRange')
    expect(compact[0].children?.[0].namePath).toBe('UserService/find[0]')
  })
})
