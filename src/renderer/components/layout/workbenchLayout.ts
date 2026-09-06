/** Serializable layout only; panel instances never belong to this tree. */
export const WORKBENCH_PANELS = ['sidebar', 'editor', 'agent'] as const
export type WorkbenchPanel = typeof WORKBENCH_PANELS[number]
export type LayoutPreset = 'classic' | 'agent'
export type TerminalPosition = 'editor' | 'agent' | 'bottom'
export type LayoutNode = WorkbenchPanel | {
  direction: 'horizontal' | 'vertical'
  ratio: number
  first: LayoutNode
  second: LayoutNode
}
export interface WorkbenchLayout {
  version: 1
  preset: LayoutPreset | 'custom'
  tree: LayoutNode
  terminalPosition: TerminalPosition
  terminalHeight: number
}
export interface PanelRect { x: number; y: number; width: number; height: number }
export interface LayoutDivider extends PanelRect {
  path: string
  direction: 'horizontal' | 'vertical'
  ratio: number
  minRatio: number
  maxRatio: number
  available: number
}
export const DIVIDER_SIZE = 5

const branch = (direction: 'horizontal' | 'vertical', first: LayoutNode, second: LayoutNode, ratio = .5): LayoutNode => ({ direction, first, second, ratio })

export function createWorkbenchLayout(preset: LayoutPreset = 'classic'): WorkbenchLayout {
  const tree = preset === 'agent'
      ? branch('horizontal', 'sidebar', branch('horizontal', 'agent', 'editor', .56), .18)
      : branch('horizontal', 'sidebar', branch('horizontal', 'editor', 'agent', .62), .2)
  return { version: 1, preset, tree, terminalPosition: 'editor', terminalHeight: 260 }
}

export function panelOrder(node: LayoutNode): WorkbenchPanel[] {
  return typeof node === 'string' ? [node] : [...panelOrder(node.first), ...panelOrder(node.second)]
}

/** Workspace files are user-editable. Reject duplicates, missing leaves and unbounded trees. */
export function normalizeWorkbenchLayout(value: unknown, legacy?: { sidebarWidth?: number; chatWidth?: number }): WorkbenchLayout {
  const fallback = createWorkbenchLayout()
  if (!value || typeof value !== 'object') {
    // Approximate legacy pixel widths on a typical desktop, then use relative sizes.
    if (legacy && typeof fallback.tree !== 'string' && typeof fallback.tree.second !== 'string') {
      const sidebar = Math.max(160, Math.min(400, Number(legacy.sidebarWidth) || 260))
      const chat = Math.max(280, Math.min(650, Number(legacy.chatWidth) || 450))
      fallback.tree.ratio = sidebar / 1400
      fallback.tree.second.ratio = 1 - chat / (1400 - sidebar)
    }
    return fallback
  }
  const raw = value as Record<string, unknown>
  const seen = new Set<string>()
  const parse = (input: unknown, depth = 0): LayoutNode | null => {
    if (typeof input === 'string') {
      if (!WORKBENCH_PANELS.includes(input as WorkbenchPanel) || seen.has(input)) return null
      seen.add(input)
      return input as WorkbenchPanel
    }
    if (!input || typeof input !== 'object' || depth > 2) return null
    const node = input as Record<string, unknown>
    if (node.direction !== 'horizontal' || typeof node.ratio !== 'number' || !Number.isFinite(node.ratio)) return null
    const first = parse(node.first, depth + 1)
    const second = parse(node.second, depth + 1)
    return first && second ? branch(node.direction as 'horizontal' | 'vertical', first, second, Math.max(.05, Math.min(.95, node.ratio))) : null
  }
  const tree = raw.version === 1 ? parse(raw.tree) : null
  if (!tree || seen.size !== 3) return fallback
  return {
    version: 1, tree,
    preset: ['classic', 'agent', 'custom'].includes(String(raw.preset)) ? raw.preset as WorkbenchLayout['preset'] : 'custom',
    terminalPosition: ['editor', 'agent', 'bottom'].includes(String(raw.terminalPosition)) ? raw.terminalPosition as TerminalPosition : 'editor',
    terminalHeight: typeof raw.terminalHeight === 'number' && Number.isFinite(raw.terminalHeight) ? Math.max(100, Math.min(1200, raw.terminalHeight)) : 260,
  }
}

export function movePanel(tree: LayoutNode, panel: WorkbenchPanel, direction: -1 | 1): LayoutNode {
  const order = panelOrder(tree), index = order.indexOf(panel), target = order[index + direction]
  if (!target) return tree
  const swap = (node: LayoutNode): LayoutNode => typeof node === 'string'
    ? node === panel ? target : node === target ? panel : node
    : { ...node, first: swap(node.first), second: swap(node.second) }
  return swap(tree)
}
export function resizeLayout(tree: LayoutNode, path: string, ratio: number): LayoutNode {
  if (typeof tree === 'string' || !Number.isFinite(ratio)) return tree
  if (!path) return { ...tree, ratio: Math.max(.05, Math.min(.95, ratio)) }
  return path[0] === '0'
    ? { ...tree, first: resizeLayout(tree.first, path.slice(1), ratio) }
    : { ...tree, second: resizeLayout(tree.second, path.slice(1), ratio) }
}

export function measureLayout(tree: LayoutNode, visible: WorkbenchPanel[], bounds: PanelRect): { panels: Partial<Record<WorkbenchPanel, PanelRect>>; dividers: LayoutDivider[] } {
  const panels: Partial<Record<WorkbenchPanel, PanelRect>> = {}, dividers: LayoutDivider[] = []
  const hasVisible = (node: LayoutNode): boolean => panelOrder(node).some(panel => visible.includes(panel))
  const minimum = (node: LayoutNode, dimension: 'width' | 'height'): number => {
    if (!hasVisible(node)) return 0
    if (typeof node === 'string') return dimension === 'height' ? 130 : node === 'sidebar' ? 160 : 280
    const a = minimum(node.first, dimension), b = minimum(node.second, dimension)
    if (!a || !b) return a + b
    return (node.direction === 'horizontal') === (dimension === 'width') ? a + b + DIVIDER_SIZE : Math.max(a, b)
  }
  const visit = (node: LayoutNode, rect: PanelRect, path: string) => {
    if (!hasVisible(node)) return
    if (typeof node === 'string') { panels[node] = rect; return }
    if (!hasVisible(node.first)) { visit(node.second, rect, path + '1'); return }
    if (!hasVisible(node.second)) { visit(node.first, rect, path + '0'); return }
    const horizontal = node.direction === 'horizontal', dimension = horizontal ? 'width' : 'height'
    const gap = Math.min(DIVIDER_SIZE, rect[dimension])
    const available = Math.max(0, rect[dimension] - gap)
    const minA = minimum(node.first, dimension), minB = minimum(node.second, dimension)
    const scale = Math.min(1, available / (minA + minB))
    const minRatio = available ? minA * scale / available : .5
    const maxRatio = available ? 1 - minB * scale / available : .5
    const ratio = Math.max(minRatio, Math.min(maxRatio, node.ratio))
    const size = available * ratio
    visit(node.first, { ...rect, [dimension]: size }, path + '0')
    dividers.push({ ...rect, x: rect.x + (horizontal ? size : 0), y: rect.y + (horizontal ? 0 : size), width: horizontal ? gap : rect.width, height: horizontal ? rect.height : gap, direction: node.direction, path, ratio, minRatio, maxRatio, available })
    visit(node.second, { ...rect, x: rect.x + (horizontal ? size + gap : 0), y: rect.y + (horizontal ? 0 : size + gap), [dimension]: available - size }, path + '1')
  }
  visit(tree, bounds, '')
  return { panels, dividers }
}

export function measureWorkbench(layout: WorkbenchLayout, visible: WorkbenchPanel[], width: number, height: number, terminalVisible: boolean, terminalCollapsed = false) {
  const bounds = { x: 0, y: 0, width: Math.max(0, width), height: Math.max(0, height) }
  const terminalSize = (available: number) => Math.min(terminalCollapsed ? 42 : layout.terminalHeight, Math.max(0, available - 130 - DIVIDER_SIZE))
  const bottomHeight = terminalVisible && layout.terminalPosition === 'bottom' ? terminalSize(height) : 0
  const result = measureLayout(layout.tree, visible, { ...bounds, height: bounds.height - (bottomHeight ? bottomHeight + DIVIDER_SIZE : 0) })
  let terminal: PanelRect | undefined, terminalDivider: PanelRect | undefined
  const target = layout.terminalPosition === 'bottom' ? bounds : result.panels[layout.terminalPosition]
  if (terminalVisible && target) {
    const size = terminalSize(target.height)
    if (size > 0) {
      terminal = { ...target, y: target.y + target.height - size, height: size }
      terminalDivider = { ...target, y: terminal.y - DIVIDER_SIZE, height: DIVIDER_SIZE }
      if (layout.terminalPosition !== 'bottom') result.panels[layout.terminalPosition] = { ...target, height: target.height - size - DIVIDER_SIZE }
    }
  }
  return { ...result, terminal, terminalDivider }
}
