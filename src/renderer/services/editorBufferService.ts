import { monaco } from '@renderer/monacoWorker'
import { useStore } from '@store'

const SNAPSHOT_DELAY_MS = 100
const pendingSnapshots = new Map<string, { content: string; timer: ReturnType<typeof setTimeout> }>()

function cancelPendingSnapshot(filePath: string): void {
  const pending = pendingSnapshots.get(filePath)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingSnapshots.delete(filePath)
}

export function getEditorBufferContent(filePath: string, fallback: string): string {
  return monaco.editor.getModel(monaco.Uri.file(filePath))?.getValue() ?? fallback
}

/** Persist a low-frequency React/store snapshot of Monaco's live buffer. */
export function scheduleEditorBufferSnapshot(filePath: string, content: string): void {
  cancelPendingSnapshot(filePath)
  const timer = setTimeout(() => {
    pendingSnapshots.delete(filePath)
    useStore.getState().updateFileContent(filePath, content)
  }, SNAPSHOT_DELAY_MS)
  pendingSnapshots.set(filePath, { content, timer })
}

export function commitEditorBufferSnapshot(filePath: string, content: string): void {
  cancelPendingSnapshot(filePath)
  useStore.getState().updateFileContent(filePath, content)
}

/** Apply an intentional programmatic edit to both the Monaco model and store. */
export function replaceEditorBufferContent(filePath: string, content: string): void {
  cancelPendingSnapshot(filePath)
  const model = monaco.editor.getModel(monaco.Uri.file(filePath))
  if (model && model.getValue() !== content) model.setValue(content)
  cancelPendingSnapshot(filePath)
  useStore.getState().updateFileContent(filePath, content)
}

/** Apply authoritative disk content and reset the model's saved version. */
export function applySavedEditorBufferContent(filePath: string, content: string): void {
  cancelPendingSnapshot(filePath)
  const { reloadFileFromDisk, markFileSaved } = useStore.getState()
  reloadFileFromDisk(filePath, content)

  const model = monaco.editor.getModel(monaco.Uri.file(filePath))
  if (!model) return
  if (model.getValue() !== content) model.setValue(content)
  cancelPendingSnapshot(filePath)
  markFileSaved(filePath, model.getAlternativeVersionId())
}

export function flushEditorBufferSnapshots(): void {
  for (const [filePath, pending] of pendingSnapshots) {
    clearTimeout(pending.timer)
    useStore.getState().updateFileContent(filePath, pending.content)
  }
  pendingSnapshots.clear()
}
