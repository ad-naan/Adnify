import { describe, expect, it } from 'vitest'
import { DocumentOwnership } from '../../src/main/lsp/documentOwnership'

describe('DocumentOwnership', () => {
  it('opens once and closes only after the last window releases a document', () => {
    const ownership = new DocumentOwnership()

    expect(ownership.acquire('ts:workspace', 'file:///a.ts', 1)).toBe(true)
    expect(ownership.acquire('ts:workspace', 'file:///a.ts', 2)).toBe(false)
    expect(ownership.release('ts:workspace', 'file:///a.ts', 1)).toBe(false)
    expect(ownership.release('ts:workspace', 'file:///a.ts', 2)).toBe(true)
  })

  it('releases all documents owned by a destroyed window', () => {
    const ownership = new DocumentOwnership()
    ownership.acquire('ts:workspace', 'file:///shared.ts', 1)
    ownership.acquire('ts:workspace', 'file:///shared.ts', 2)
    ownership.acquire('ts:workspace', 'file:///only-one.ts', 1)

    expect(ownership.releaseOwner(1)).toEqual([
      { serverKey: 'ts:workspace', uri: 'file:///only-one.ts' },
    ])
    expect(ownership.releaseOwner(2)).toEqual([
      { serverKey: 'ts:workspace', uri: 'file:///shared.ts' },
    ])
  })

  it('clears owner references when a server is stopped', () => {
    const ownership = new DocumentOwnership()
    ownership.acquire('ts:workspace', 'file:///a.ts', 1)
    ownership.clearServer('ts:workspace')

    expect(ownership.releaseOwner(1)).toEqual([])
    expect(ownership.acquire('ts:workspace', 'file:///a.ts', 1)).toBe(true)
  })

  it('releases one URI without requiring the caller to know its server key', () => {
    const ownership = new DocumentOwnership()
    ownership.acquire('ts:workspace', 'file:///a.ts', 1)
    ownership.acquire('py:workspace', 'file:///b.py', 1)

    expect(ownership.releaseOwnerDocument(1, 'file:///a.ts')).toEqual([
      { serverKey: 'ts:workspace', uri: 'file:///a.ts' },
    ])
    expect(ownership.releaseOwner(1)).toEqual([
      { serverKey: 'py:workspace', uri: 'file:///b.py' },
    ])
  })

  it('keeps one shared document open across many windows without duplicate ownership', () => {
    const ownership = new DocumentOwnership()
    const windowCount = 100

    for (let ownerId = 1; ownerId <= windowCount; ownerId++) {
      expect(ownership.acquire('ts:workspace', 'file:///shared.ts', ownerId))
        .toBe(ownerId === 1)
      expect(ownership.acquire('ts:workspace', 'file:///shared.ts', ownerId)).toBe(false)
    }

    for (let ownerId = 1; ownerId < windowCount; ownerId++) {
      expect(ownership.release('ts:workspace', 'file:///shared.ts', ownerId)).toBe(false)
    }
    expect(ownership.release('ts:workspace', 'file:///shared.ts', windowCount)).toBe(true)
  })
})
