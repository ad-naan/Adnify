import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Static guards for the plan workbench components.
 *
 * There is no jsdom/testing-library in this project, so these components are
 * never rendered by the suite. That is exactly how `PlanHistoryDrawer` shipped
 * a `<History />` usage with no matching import — a guaranteed ReferenceError
 * on the "no matching search results" branch, invisible to both `vitest` and
 * (until tsconfig was scoped) easy to miss in review.
 *
 * These tests parse the source instead of rendering it.
 */

const WORKBENCH_DIR = join(__dirname, '../../../src/renderer/components/plan/workbench')

function sourceFiles(): Array<{ name: string; text: string }> {
  return readdirSync(WORKBENCH_DIR)
    .filter(name => name.endsWith('.tsx'))
    .map(name => ({ name, text: readFileSync(join(WORKBENCH_DIR, name), 'utf8') }))
}

/** Collect every identifier bound by an import statement. */
function importedNames(text: string): Set<string> {
  const names = new Set<string>()
  const importRe = /import\s+(?:type\s+)?([^'"]+?)\s+from\s+['"][^'"]+['"]/g
  for (const match of text.matchAll(importRe)) {
    const clause = match[1]
    for (const braced of clause.matchAll(/\{([^}]*)\}/g)) {
      for (const raw of braced[1].split(',')) {
        const name = raw.replace(/^\s*type\s+/, '').split(/\s+as\s+/).pop()?.trim()
        if (name) names.add(name)
      }
    }
    const withoutBraces = clause.replace(/\{[^}]*\}/g, '')
    for (const raw of withoutBraces.split(',')) {
      const name = raw.replace(/^\s*\*\s*as\s*/, '').trim()
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  }
  return names
}

/**
 * PascalCase JSX tags, e.g. <History />, <PlanWorkbenchQuestion ...>.
 *
 * Excludes generic type arguments like `useRef<HTMLElement>(null)` and
 * `useState<Foo>()`, which are syntactically `<Name>` but not JSX. A JSX tag is
 * preceded by `(`, `{`, `>`, `&&`, `?`, `:`, `,`, `return`, or start-of-line —
 * never by an identifier character (which would make it a generic).
 */
function jsxComponentTags(text: string): Set<string> {
  const tags = new Set<string>()
  for (const match of text.matchAll(/(^|[^\w$.])<([A-Z][\w$]*)[\s/>]/gm)) {
    const preceding = match[1]
    // A generic follows an identifier directly (useRef<T>), which the negated
    // class above already rejects. Guard the remaining `foo <T>` spacing case.
    if (/\s/.test(preceding) && /[\w$]\s*$/.test(text.slice(0, match.index))) {
      const before = text.slice(0, match.index).trimEnd()
      if (/(?:useRef|useState|useMemo|useCallback|Record|Array|Set|Map|Promise)$/.test(before)) continue
    }
    tags.add(match[2])
  }
  return tags
}

describe('plan workbench components', () => {
  it('every PascalCase JSX tag resolves to an import or a local declaration', () => {
    const problems: string[] = []

    for (const { name, text } of sourceFiles()) {
      const imported = importedNames(text)
      const declared = new Set<string>()
      for (const re of [
        /(?:function|class)\s+([A-Z][\w$]*)/g,
        /(?:const|let|var)\s+([A-Z][\w$]*)\s*[=:]/g,
      ]) {
        for (const match of text.matchAll(re)) declared.add(match[1])
      }

      for (const tag of jsxComponentTags(text)) {
        if (!imported.has(tag) && !declared.has(tag)) {
          problems.push(`${name}: <${tag} /> is neither imported nor declared locally`)
        }
      }
    }

    expect(problems).toEqual([])
  })

  it('PlanHistoryDrawer imports the History icon it renders in its empty state', () => {
    const text = readFileSync(join(WORKBENCH_DIR, 'PlanHistoryDrawer.tsx'), 'utf8')
    expect(text).toMatch(/<History\b/)
    expect(importedNames(text).has('History')).toBe(true)
  })
})
