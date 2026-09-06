import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { createStore } from 'zustand/vanilla'
import { createLayoutSlice, type LayoutSlice } from '@renderer/store/slices/layoutSlice'
import { createWorkbenchLayout, movePanel, measureWorkbench, normalizeWorkbenchLayout, panelOrder, resizeLayout, WORKBENCH_PANELS, type PanelRect } from '@renderer/components/layout/workbenchLayout'

const overlap = (a: PanelRect, b: PanelRect) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > .01 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > .01

describe('workbench docking model', () => {
  it('preserves every panel exactly once through arbitrary moves and round trips', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.constantFrom(...WORKBENCH_PANELS), fc.constantFrom<-1 | 1>(-1, 1)), { maxLength: 60 }), operations => {
      let layout = createWorkbenchLayout()
      for (const [panel, direction] of operations) {
        layout = { ...layout, tree: movePanel(layout.tree, panel, direction), preset: 'custom' }
        expect(panelOrder(layout.tree).sort()).toEqual([...WORKBENCH_PANELS].sort())
        expect(normalizeWorkbenchLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout)
      }
    }), { numRuns: 100 })
  })

  it('never overlaps panels or terminals across moves, visibility and window sizes', () => {
    fc.assert(fc.property(fc.integer({ min: 280, max: 2560 }), fc.integer({ min: 100, max: 1600 }), fc.subarray([...WORKBENCH_PANELS], { minLength: 1 }), fc.constantFrom('classic', 'agent') as fc.Arbitrary<'classic' | 'agent'>, fc.constantFrom('editor', 'agent', 'bottom') as fc.Arbitrary<'editor' | 'agent' | 'bottom'>, (width, height, visible, preset, position) => {
      const layout = { ...createWorkbenchLayout(preset), terminalPosition: position }
      const result = measureWorkbench(layout, visible, width, height, true)
      const rects = [...Object.values(result.panels), ...(result.terminal ? [result.terminal] : [])]
      for (const rect of rects) {
        expect(rect.width).toBeGreaterThanOrEqual(0)
        expect(rect.height).toBeGreaterThanOrEqual(0)
        expect(rect.x + rect.width).toBeLessThanOrEqual(width + .001)
        expect(rect.y + rect.height).toBeLessThanOrEqual(height + .001)
        expect(rect.x).toBeGreaterThanOrEqual(0)
        expect(rect.y).toBeGreaterThanOrEqual(0)
      }
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j])).toBe(false)
    }), { numRuns: 300 })
  })

  it('keeps a hidden panel in its original slot and preserves resize paths', () => {
    const layout = createWorkbenchLayout()
    const original = JSON.stringify(layout.tree)
    const hidden = measureWorkbench(layout, ['editor', 'agent'], 1400, 900, false)
    expect(hidden.dividers[0].path).toBe('1')
    const changed = resizeLayout(layout.tree, hidden.dividers[0].path, .75)
    expect(measureWorkbench({ ...layout, tree: changed }, [...WORKBENCH_PANELS], 1400, 900, false).panels.sidebar).toEqual(measureWorkbench(layout, [...WORKBENCH_PANELS], 1400, 900, false).panels.sidebar)
    expect(JSON.stringify(layout.tree)).toBe(original)
  })

  it('focuses without altering the tree and reserves terminal height', () => {
    const layout = createWorkbenchLayout('agent')
    const focused = measureWorkbench(layout, ['agent'], 1200, 800, true)
    expect(focused.panels.agent).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
    expect(focused.terminal).toBeUndefined()
    const result = measureWorkbench(layout, [...WORKBENCH_PANELS], 1200, 650, true)
    expect(result.panels.editor!.height).toBeGreaterThanOrEqual(130)
    expect(result.terminal!.y).toBeGreaterThan(result.panels.editor!.y + result.panels.editor!.height)
  })

  it('rejects corrupt, duplicate, missing, deeply nested and future layout files', () => {
    for (const tree of ['agent', { direction: 'horizontal', ratio: .5, first: 'editor', second: 'editor' }, { direction: 'diagonal', ratio: .5 }, { direction: 'horizontal', ratio: NaN, first: 'sidebar', second: 'agent' }]) {
      expect(normalizeWorkbenchLayout({ version: 1, tree })).toEqual(createWorkbenchLayout())
    }
    expect(normalizeWorkbenchLayout({ ...createWorkbenchLayout(), version: 2 })).toEqual(createWorkbenchLayout())
    expect(normalizeWorkbenchLayout({ version: 1, preset: 'stacked', tree: { direction: 'horizontal', ratio: .2, first: 'sidebar', second: { direction: 'vertical', ratio: .5, first: 'editor', second: 'agent' } } })).toEqual(createWorkbenchLayout())
    const legacy = normalizeWorkbenchLayout(undefined, { sidebarWidth: 300, chatWidth: 500 })
    expect(panelOrder(legacy.tree)).toEqual(['sidebar', 'editor', 'agent'])
  })
})

describe('workbench visibility actions', () => {
  it('keeps at least one primary panel available and exits focus on reveal', () => {
    const store = createStore<LayoutSlice>()(createLayoutSlice)
    store.getState().setChatVisible(false)
    store.getState().setActiveSidePanel(null)
    store.getState().setEditorVisible(false)
    expect(store.getState().editorVisible).toBe(true)
    store.getState().setFocusedPanel('editor')
    store.getState().setChatVisible(true)
    expect(store.getState().focusedPanel).toBeNull()
  })
  it('shows the terminal destination and clears focus while preserving the tree', () => {
    const store = createStore<LayoutSlice>()(createLayoutSlice)
    const tree = store.getState().workbenchLayout.tree
    store.getState().setChatVisible(false)
    store.getState().setFocusedPanel('editor')
    store.getState().setTerminalPosition('agent')
    expect(store.getState()).toMatchObject({ terminalVisible: true, chatVisible: true, focusedPanel: null })
    expect(store.getState().workbenchLayout.tree).toBe(tree)
  })
  it('restores all columns through a preset without losing terminal preferences', () => {
    const store = createStore<LayoutSlice>()(createLayoutSlice)
    store.getState().setTerminalPosition('bottom')
    store.getState().setActiveSidePanel('shell')
    store.getState().applyLayoutPreset('agent')
    expect(store.getState()).toMatchObject({ activeSidePanel: 'explorer', editorVisible: true, chatVisible: true, focusedPanel: null })
    expect(store.getState().workbenchLayout.terminalPosition).toBe('bottom')
    expect(panelOrder(store.getState().workbenchLayout.tree)).toEqual(['sidebar', 'agent', 'editor'])
  })
})
