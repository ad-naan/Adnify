import ts from 'typescript'

export interface EditorSyntaxInput {
  before: string
  after: string
  extension: string
}

const names = new Map(Object.entries(ts.SyntaxKind).flatMap(([name, value]) =>
  typeof value === 'number' && !/^(First|Last|Count)/.test(name) ? [[value, name] as const] : [],
))

export function summarizeSyntax({ before, after, extension }: EditorSyntaxInput) {
  const changes = new Map<string, { kind: string; parent: string; delta: number }>()
  const collect = (text: string, direction: number) => {
    const source = ts.createSourceFile(`editor.${extension}`, text, ts.ScriptTarget.Latest, false)
    const visit = (node: ts.Node, parent: ts.Node) => {
      const kind = names.get(node.kind)
      const parentKind = names.get(parent.kind)
      if (node.getChildCount(source) && kind && parentKind) {
        const key = `${kind}.${parentKind}`
        const change = changes.get(key) ?? { kind, parent: parentKind, delta: 0 }
        change.delta += direction
        changes.set(key, change)
      }
      ts.forEachChild(node, child => visit(child, node))
    }
    ts.forEachChild(source, node => visit(node, source))
  }
  collect(before, -1)
  collect(after, 1)
  return [...changes.values()].filter(change => change.delta !== 0)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta)).slice(0, 10)
}
