import { useStore } from '@store'

/** Opening a file from search or Explorer must reveal an editor hidden by the layout. */
export function syncWorkbenchEditorVisibility(): () => void {
  return useStore.subscribe((state, previous) => {
    if (!state.activeFilePath) return
    const currentFile = state.openFiles.find(file => file.path === state.activeFilePath)
    const previousFile = previous.openFiles.find(file => file.path === previous.activeFilePath)
    const activated = state.activeFilePath !== previous.activeFilePath || currentFile?.lastAccessed !== previousFile?.lastAccessed
    if (!activated) return
    if (!state.editorVisible || (state.focusedPanel && state.focusedPanel !== 'editor')) state.setEditorVisible(true)
    if (state.activeSidePanel === 'shell') state.setActiveSidePanel('explorer')
  })
}
