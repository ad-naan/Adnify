import { describe, expect, it } from 'vitest'
import { analyzeWriteIntent, guardWriteFile } from '@/renderer/agent/tools/fileWriteStrategy'

describe('fileWriteStrategy', () => {
  it('classifies empty original content as create', () => {
    const result = analyzeWriteIntent('', 'export const created = true\n')

    expect(result.intent).toBe('create')
    expect(result.changedNewChars).toBeGreaterThan(0)
  })

  it('allows intentional full rewrite on existing file without recent read', () => {
    const originalContent = [
      'export function legacyThing() {',
      '  return "legacy"',
      '}',
      '',
    ].join('\n')
    const nextContent = [
      'import { modernThing } from "./modern"',
      '',
      'export function rewrittenThing() {',
      '  return modernThing("rewritten")',
      '}',
      '',
    ].join('\n')

    const decision = guardWriteFile({
      path: '/repo/src/example.ts',
      originalContent,
      nextContent,
      hasRecentRead: false,
    })

    expect(decision.allow).toBe(true)
    expect(decision.intent).toBe('full-rewrite')
  })

  it('still rejects partial update without recent read', () => {
    const originalContent = [
      'export function greet() {',
      '  const subject = "world"',
      '  return `hello ${subject}`',
      '}',
      '',
    ].join('\n')
    const nextContent = [
      'export function greet() {',
      '  const subject = "team"',
      '  return `hello ${subject}`',
      '}',
      '',
    ].join('\n')

    const decision = guardWriteFile({
      path: '/repo/src/example.ts',
      originalContent,
      nextContent,
      hasRecentRead: false,
    })

    expect(decision.allow).toBe(false)
    expect(decision.intent).toBe('partial-update')
    expect(decision.reason).toContain('Use edit_file instead')
    expect(decision.reason).toContain('Read the file first')
  })
})
