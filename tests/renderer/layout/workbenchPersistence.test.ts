import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '@store'
import { saveWorkspaceState, restoreWorkspaceState } from '@renderer/services/workspaceStateService'
import { workspaceStateRepository, type WorkspaceStateData } from '@renderer/services/workspaceStateRepository'
import { createWorkbenchLayout, movePanel } from '@renderer/components/layout/workbenchLayout'
import { syncWorkbenchEditorVisibility } from '@renderer/components/layout/workbenchVisibility'

vi.mock('@renderer/services/workspaceStateRepository', () => ({ workspaceStateRepository: { get: vi.fn(), save: vi.fn() } }))

const empty: WorkspaceStateData = { openFiles: [], activeFile: null, expandedFolders: [], scrollPositions: {}, cursorPositions: {} }
beforeEach(() => {
  vi.clearAllMocks()
  useStore.setState({ openFiles: [], activeFilePath: null, expandedFolders: new Set(), workbenchLayout: createWorkbenchLayout(), activeSidePanel: 'explorer', editorVisible: true, chatVisible: true, focusedPanel: null })
})

describe('workspace layout persistence', () => {
  it('reveals a hidden editor on file activation, without interrupting focus when typing', () => {
    const unsubscribe = syncWorkbenchEditorVisibility()
    try {
      useStore.getState().setEditorVisible(false)
      useStore.getState().setFocusedPanel('agent')
      useStore.getState().openFile('E:/Project/blog/a.ts', 'const a = 1')
      expect(useStore.getState()).toMatchObject({ editorVisible: true, focusedPanel: null })
      useStore.getState().setFocusedPanel('editor')
      useStore.getState().updateFileContent('E:/Project/blog/a.ts', 'const a = 2')
      expect(useStore.getState().focusedPanel).toBe('editor')
    } finally { unsubscribe() }
  })
  it('round trips docking, dimensions and hidden columns without persisting temporary focus', async () => {
    const layout = createWorkbenchLayout('agent')
    layout.tree = movePanel(layout.tree, 'sidebar', 1)
    layout.preset = 'custom'; layout.terminalPosition = 'agent'; layout.terminalHeight = 180
    useStore.setState({ workbenchLayout: layout, focusedPanel: 'agent', activeSidePanel: null, editorVisible: false })
    await saveWorkspaceState()
    const saved = vi.mocked(workspaceStateRepository.save).mock.calls[0][0]
    expect(saved.layout?.workbench).toEqual(layout)
    expect(saved.layout).not.toHaveProperty('focusedPanel')
    vi.mocked(workspaceStateRepository.get).mockResolvedValue(saved)
    useStore.getState().applyLayoutPreset('classic')
    await restoreWorkspaceState()
    expect(useStore.getState()).toMatchObject({ workbenchLayout: layout, focusedPanel: null, activeSidePanel: null, editorVisible: false, chatVisible: true })
  })
  it('resets the previous project layout for a new workspace without a saved state', async () => {
    useStore.getState().applyLayoutPreset('agent')
    useStore.getState().setChatVisible(false)
    vi.mocked(workspaceStateRepository.get).mockResolvedValue(empty)
    await restoreWorkspaceState()
    expect(useStore.getState()).toMatchObject({ workbenchLayout: createWorkbenchLayout(), editorVisible: true, chatVisible: true, activeSidePanel: 'explorer' })
  })
  it('recovers an all-hidden workspace and migrates old pixel widths', async () => {
    vi.mocked(workspaceStateRepository.get).mockResolvedValue({ ...empty, layout: { sidebarWidth: 300, chatWidth: 500, terminalVisible: false, terminalLayout: 'tabs', activeSidePanel: null, editorVisible: false, chatVisible: false } })
    await restoreWorkspaceState()
    expect(useStore.getState().editorVisible).toBe(true)
    expect(useStore.getState().workbenchLayout.tree).not.toEqual(createWorkbenchLayout().tree)
  })
})
